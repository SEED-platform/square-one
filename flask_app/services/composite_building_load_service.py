"""
Composite Building Load Profile service.

Wraps the `building_energy_profiles` package (ComStock/ResStock downloader + ENERGY STAR Portfolio
Manager (ESPM) crosswalk + composite/"mixed-use" building blending) to turn a Square One building's
assigned ESPM building type(s) into a downloadable annual load profile:

- A building with a single assigned (primary) ESPM building type gets that BuildStock building type's
  own representative time series.
- A building with 2-3 assigned ESPM building types (primary/secondary/tertiary, each with a floor-area
  weight) gets a floor-area-weighted composite ("mixed-use") time series, blending a representative
  building per component.

See `list_espm_building_types()` for the crosswalk used to populate a building-type picker in the UI,
and `pull_building_load_profile()` for the per-building download/combine entry point used by the
`/api/download_composite_building_load_profiles` route.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd
from building_energy_profiles import CompositeBuildingType, ComStockProcessor, ResStockProcessor, pull_composite_time_series
from building_energy_profiles.composite import find_nearest_sqft_bldg_id, normalize_time_series_columns
from building_energy_profiles.energy_star_crosswalk import energy_star_crosswalk, map_energy_star_property_type

logger = logging.getLogger(__name__)

# Where downloaded BuildStock metadata/time series get cached between requests, keyed by
# state/county/building-type/upgrade -- see `building_energy_profiles.BuildStockProcessor`.
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "building_energy_profiles"

# Durable server-side copies of generated profiles. Unlike CACHE_DIR, this location represents user
# output and is not part of the package's disposable download cache.
LOAD_PROFILE_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "load_profiles"

# The building-type "slots" a Square One building can be assigned, in priority order. Each slot is stored
# on the building's properties as `espm_building_type_<slot>` (an ENERGY STAR property type string) and
# `espm_building_type_<slot>_weight` (a floor-area share, as a percentage 0-100).
BUILDING_TYPE_SLOTS = ("primary", "secondary", "tertiary")

BASELINE_UPGRADE = "0"


class CompositeBuildingLoadError(ValueError):
    """Raised for building-level problems that a user can fix (missing state, no building type assigned,
    an assigned ESPM type with no BuildStock equivalent, no sample buildings found, etc.), as opposed to
    unexpected/internal errors. The route layer reports these back to the user as-is.
    """


def list_espm_building_types() -> list[dict[str, Any]]:
    """Return every packaged ENERGY STAR Portfolio Manager property type and its BuildStock crosswalk
    entry, for populating a building-type picker (and letting the UI flag `match_quality="unmapped"`
    types, which can't be used to download a load profile).
    """
    return [
        {
            "property_type": mapping.energy_star_property_type,
            "buildstock_product": mapping.buildstock_product,
            "buildstock_building_type": mapping.buildstock_building_type,
            "match_quality": mapping.match_quality,
            "notes": mapping.notes,
        }
        for mapping in energy_star_crosswalk()
    ]


def _building_type_slots(properties: dict[str, Any]) -> list[tuple[str, float]]:
    """Extract this building's assigned `(espm_property_type, weight)` pairs, skipping blank/zero-weight
    slots. Weights are read as-is (e.g. percentages); only their relative size matters -- see
    `_resolve_components()`.
    """
    slots: list[tuple[str, float]] = []
    for slot in BUILDING_TYPE_SLOTS:
        property_type = str(properties.get(f"espm_building_type_{slot}", "") or "").strip()
        if not property_type:
            continue
        try:
            weight = float(properties.get(f"espm_building_type_{slot}_weight", 0) or 0)
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            continue
        slots.append((property_type, weight))
    return slots


def _resolve_components(slots: list[tuple[str, float]]) -> dict[tuple[str, str], float]:
    """Map each assigned `(espm_property_type, weight)` slot to a `(buildstock_product,
    buildstock_building_type)` key via the ESPM crosswalk, combining any slots that happen to resolve to
    the same BuildStock building type, then normalizing the result to fractions summing to 1.0.

    Raises:
        CompositeBuildingLoadError: if none of the assigned building types has a BuildStock equivalent.
    """
    resolved: dict[tuple[str, str], float] = {}
    unmapped: list[str] = []
    for property_type, weight in slots:
        mapping = map_energy_star_property_type(property_type)
        if mapping is None or mapping.buildstock_building_type is None or mapping.buildstock_product is None:
            unmapped.append(property_type)
            continue
        key = (mapping.buildstock_product, mapping.buildstock_building_type)
        resolved[key] = resolved.get(key, 0.0) + weight

    if not resolved:
        detail = f" ({', '.join(unmapped)} have no BuildStock equivalent)" if unmapped else ""
        raise CompositeBuildingLoadError(
            f"None of this building's assigned ESPM building types could be mapped to a BuildStock building type{detail}."
        )

    total = sum(resolved.values())
    return {key: weight / total for key, weight in resolved.items()}


def _to_positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _safe_filename_part(value: Any, fallback: str) -> str:
    """Return a short, filesystem-safe filename component without allowing path traversal."""
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value or "")).strip("_")
    return cleaned[:80] or fallback


def _save_profile_csv(
    building: dict[str, Any],
    csv_text: str,
    resample: str,
    output_dir: Path,
) -> Path:
    """Persist one generated profile in the shared server output directory and return its path."""
    building_id = _safe_filename_part(building.get("id"), "building")
    properties = building.get("properties") or {}
    label = properties.get("street_address") or properties.get("PROP_ADDR") or "building"
    building_label = _safe_filename_part(label, "building")
    resolution = _safe_filename_part(resample, "native")
    filename = f"{building_label}_{building_id}_{resolution}_load_profile.csv"

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_text(csv_text, encoding="utf-8")
    return output_path.resolve()


def _build_processor(product: str, state: str, county_name: str, building_type: str) -> ComStockProcessor | ResStockProcessor:
    processor_cls = ComStockProcessor if product == "comstock" else ResStockProcessor
    base_dir = CACHE_DIR / product
    base_dir.mkdir(parents=True, exist_ok=True)
    return processor_cls(state=state, county_name=county_name, building_type=building_type, upgrade=BASELINE_UPGRADE, base_dir=base_dir)


def _pull_single_component_time_series(
    product: str,
    building_type: str,
    state: str,
    county_name: str,
    target_sqft: float | None,
) -> pd.DataFrame:
    """Download one representative building's time series for a building with only one assigned
    (mapped) building type -- `CompositeBuildingType` requires 2+ components, so this bypasses it.
    """
    processor = _build_processor(product, state, county_name, building_type)
    metadata = processor.process_metadata(save_dir=processor.base_dir)
    if metadata.empty:
        raise CompositeBuildingLoadError(f"No BuildStock sample buildings found for '{building_type}' ({product}) in state '{state}'.")

    sqft_column = next((column for column in metadata.columns if column.startswith("in.sqft")), None)
    if target_sqft and sqft_column:
        # Pick a real building already close in size to the target, rather than an arbitrary "first
        # found" one that then gets linearly rescaled -- see find_nearest_sqft_bldg_id().
        bldg_id = find_nearest_sqft_bldg_id(metadata, target_sqft, sqft_column=sqft_column)
        sample = metadata[metadata["bldg_id"] == bldg_id]
    else:
        sample = metadata.head(1)

    sample_sqft = float(sample[sqft_column].iloc[0]) if sqft_column and not sample.empty else None

    ts_dir = processor.base_dir / "timeseries" / f"upgrade_{BASELINE_UPGRADE}"
    ts_dir.mkdir(parents=True, exist_ok=True)
    paths, _building_ids = processor.process_building_time_series(sample[["bldg_id", "in.state"]], save_dir=ts_dir)
    if not paths:
        raise CompositeBuildingLoadError(f"Failed to download time series for '{building_type}' ({product}).")

    combined = normalize_time_series_columns(pd.read_parquet(paths[0]))

    if target_sqft and sample_sqft:
        scale = target_sqft / sample_sqft
        numeric_columns = [
            column
            for column in combined.columns
            if column not in {"timestamp", "bldg_id"} and pd.api.types.is_numeric_dtype(combined[column])
        ]
        combined = combined.copy()
        combined[numeric_columns] = combined[numeric_columns] * scale

    return combined


def _resample_hourly(data_frame: pd.DataFrame, timestamp_column: str = "timestamp") -> pd.DataFrame:
    """Resample a native (typically 15-minute) time series to hourly means."""
    indexed = data_frame.set_index(pd.to_datetime(data_frame[timestamp_column]).rename(timestamp_column)).drop(columns=[timestamp_column])
    return indexed.resample("1h").mean().reset_index()


def _representative_building(
    product: str,
    building_type: str,
    time_series: pd.DataFrame,
) -> dict[str, str] | None:
    """Describe the BuildStock sample building represented by a downloaded component time series."""
    if time_series.empty or "bldg_id" not in time_series.columns:
        return None

    raw_building_id = time_series["bldg_id"].iloc[0]
    if pd.isna(raw_building_id):
        return None
    if isinstance(raw_building_id, (int, float)) and float(raw_building_id).is_integer():
        building_id = str(int(raw_building_id))
    else:
        building_id = str(raw_building_id)
    return {
        "buildstock_product": product,
        "buildstock_building_type": building_type,
        "building_id": building_id,
    }


def pull_building_load_profile(properties: dict[str, Any], resample: str = "native") -> dict[str, Any]:
    """Download (and, when 2-3 building types are assigned, combine) one Square One building's composite
    building load profile, based on its assigned ESPM building type(s)/weight(s), `state`, and (optional)
    `gross_floor_area`.

    Args:
        properties: the building's row properties, expected to include `state` (2-letter), optionally
            `county` and `gross_floor_area`, and up to 3 `espm_building_type_<slot>`/
            `espm_building_type_<slot>_weight` pairs (see `BUILDING_TYPE_SLOTS`).
        resample: `"native"` (~15-minute intervals, as published) or `"hourly"`.

    Returns:
        A dict with the resolved `components`, the representative BuildStock building ID used for each
        component, `state`, `county`, `row_count`, and the resulting time series as `csv` text.

    Raises:
        CompositeBuildingLoadError: for any user-fixable problem (missing state, no building type
            assigned, an unmapped building type, or no matching sample buildings).
    """
    state = str(properties.get("state", "") or "").strip().upper()
    if len(state) != 2 or not state.isalpha():
        raise CompositeBuildingLoadError("A valid 2-letter `state` is required to look up BuildStock data for this building.")

    slots = _building_type_slots(properties)
    if not slots:
        raise CompositeBuildingLoadError(
            "No ESPM building type has been assigned to this building yet. Use 'Assign Building Types' to set at least a primary "
            "building type before downloading a load profile.",
        )

    fractions = _resolve_components(slots)
    county_name = str(properties.get("county", "") or "").strip() or "All"
    target_sqft = _to_positive_float(properties.get("gross_floor_area"))

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if len(fractions) == 1:
        (product, building_type), _fraction = next(iter(fractions.items()))
        combined = _pull_single_component_time_series(product, building_type, state, county_name, target_sqft)
        representative = _representative_building(product, building_type, combined)
        representative_buildings = [representative] if representative else []
    else:
        composite = CompositeBuildingType.from_fractions("square-one composite", fractions)
        combined, component_series = pull_composite_time_series(
            composite,
            save_dir=CACHE_DIR,
            state=state,
            county_name=county_name,
            total_sqft=target_sqft,
        )
        representative_buildings = [
            representative
            for (product, building_type), time_series in component_series.items()
            if (representative := _representative_building(product, building_type, time_series)) is not None
        ]

    if resample == "hourly":
        combined = _resample_hourly(combined)

    return {
        "components": [
            {"buildstock_product": product, "buildstock_building_type": building_type, "fraction": round(fraction, 4)}
            for (product, building_type), fraction in fractions.items()
        ],
        "state": state,
        "county": county_name,
        "representative_buildings": representative_buildings,
        "row_count": len(combined),
        "csv": combined.to_csv(index=False),
    }


def pull_building_load_profiles(
    buildings: list[dict[str, Any]],
    resample: str = "native",
    output_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Download a composite building load profile for each of `buildings` (`[{"id", "properties"}, ...]`),
    save each successful CSV in a shared server directory, and isolate failures per building so one bad
    building (missing state, no sample data, etc.) doesn't stop the rest of the batch.
    """
    destination = output_dir or LOAD_PROFILE_OUTPUT_DIR
    results: list[dict[str, Any]] = []
    for building in buildings:
        building_id = str(building.get("id", ""))
        properties = building.get("properties") or {}
        try:
            profile = pull_building_load_profile(properties, resample=resample)
            file_path = _save_profile_csv(building, profile["csv"], resample, destination)
            results.append({"id": building_id, "success": True, "file_path": str(file_path), **profile})
        except CompositeBuildingLoadError as e:
            results.append({"id": building_id, "success": False, "error": str(e)})
        except Exception as e:
            logger.exception("Unexpected error downloading composite building load profile for building %s", building_id)
            results.append({"id": building_id, "success": False, "error": f"Unexpected error: {e}"})
    return results
