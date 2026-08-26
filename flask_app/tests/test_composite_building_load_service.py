"""
Tests for the composite building load profile service.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from flask_app.services.composite_building_load_service import (
    CompositeBuildingLoadError,
    _building_type_slots,
    _resolve_components,
    _select_representative_metadata_row,
    list_espm_building_types,
    pull_building_load_profile,
    pull_building_load_profiles,
)

_SAMPLE_TIME_SERIES = pd.DataFrame(
    {
        "bldg_id": [101, 101, 101, 101],
        "timestamp": pd.date_range("2018-01-01", periods=4, freq="15min"),
        "out.electricity.total.energy_consumption": [1.0, 2.0, 3.0, 4.0],
    }
)

_SAMPLE_SELECTION_AUDIT = {
    "selection_method": "floor_area_and_eui",
    "target_floor_area_ft2": 50000.0,
    "sample_floor_area_ft2": 48000.0,
    "target_site_eui_kbtu_ft2": 52.4,
    "sample_site_eui_kbtu_ft2": 50.0,
    "floor_area_relative_difference_pct": 4.0,
    "site_eui_relative_difference_pct": 4.58,
    "combined_relative_distance": 0.085802,
    "candidate_count": 200,
    "eligible_candidate_count": 200,
}


def _load_profile_properties(**overrides):
    properties = {
        "state": "CO",
        "gross_floor_area": 50000,
        "weather_normalized_site_eui": 52.4,
        "espm_building_type_primary": "Bank Branch",
        "espm_building_type_primary_weight": 100,
    }
    properties.update(overrides)
    return properties


class TestListEspmBuildingTypes(unittest.TestCase):
    """Tests for list_espm_building_types()."""

    def test_returns_every_crosswalk_entry_with_expected_keys(self):
        building_types = list_espm_building_types()

        self.assertGreater(len(building_types), 0)
        bank_branch = next(bt for bt in building_types if bt["property_type"] == "Bank Branch")
        self.assertEqual(bank_branch["buildstock_product"], "comstock")
        self.assertEqual(bank_branch["buildstock_building_type"], "SmallOffice")
        self.assertIn(bank_branch["match_quality"], {"exact", "approximate", "unmapped"})

        # At least one packaged type has no BuildStock equivalent -- verifies unmapped entries pass through.
        self.assertTrue(any(bt["match_quality"] == "unmapped" for bt in building_types))


class TestBuildingTypeSlots(unittest.TestCase):
    """Tests for _building_type_slots()."""

    def test_extracts_only_filled_positive_weight_slots(self):
        properties = {
            "espm_building_type_primary": "Bank Branch",
            "espm_building_type_primary_weight": 70,
            "espm_building_type_secondary": "",
            "espm_building_type_secondary_weight": 30,
            "espm_building_type_tertiary": "Strip Mall",
            "espm_building_type_tertiary_weight": 0,
        }

        slots = _building_type_slots(properties)

        self.assertEqual(slots, [("Bank Branch", 70.0)])

    def test_handles_missing_or_invalid_weights_gracefully(self):
        properties = {"espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": "not-a-number"}

        self.assertEqual(_building_type_slots(properties), [])


class TestResolveComponents(unittest.TestCase):
    """Tests for _resolve_components()."""

    def test_normalizes_weights_to_sum_to_one(self):
        fractions = _resolve_components([("Bank Branch", 70), ("Strip Mall", 30)])

        self.assertAlmostEqual(sum(fractions.values()), 1.0)
        self.assertAlmostEqual(fractions[("comstock", "SmallOffice")], 0.7)
        self.assertAlmostEqual(fractions[("comstock", "RetailStripmall")], 0.3)

    def test_combines_slots_resolving_to_the_same_buildstock_type(self):
        # "Financial Office" also maps to SmallOffice -- should combine with "Bank Branch" rather than
        # producing two components with the same (product, building_type) key.
        fractions = _resolve_components([("Bank Branch", 50), ("Financial Office", 50)])

        self.assertEqual(len(fractions), 1)
        self.assertAlmostEqual(fractions[("comstock", "SmallOffice")], 1.0)

    def test_raises_when_every_slot_is_unmapped(self):
        with pytest.raises(CompositeBuildingLoadError):
            _resolve_components([("Parking", 100)])


class TestPullBuildingLoadProfile(unittest.TestCase):
    """Tests for pull_building_load_profile(), mocking out the actual BuildStock download."""

    def test_requires_a_valid_state(self):
        with pytest.raises(CompositeBuildingLoadError):
            pull_building_load_profile({"espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": 100})

    def test_requires_at_least_one_assigned_building_type(self):
        with pytest.raises(CompositeBuildingLoadError):
            pull_building_load_profile({"state": "CO"})

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_single_building_type_uses_single_component_path(self, mock_pull_single):
        mock_pull_single.return_value = (_SAMPLE_TIME_SERIES, _SAMPLE_SELECTION_AUDIT)

        result = pull_building_load_profile(_load_profile_properties(state="co"))

        mock_pull_single.assert_called_once()
        self.assertEqual(result["state"], "CO")
        self.assertEqual(result["row_count"], 4)
        self.assertEqual(len(result["components"]), 1)
        self.assertEqual(result["components"][0]["buildstock_building_type"], "SmallOffice")
        self.assertEqual(result["representative_buildings"][0]["building_id"], "101")
        self.assertEqual(result["representative_buildings"][0]["candidate_count"], 200)
        self.assertIn("out.electricity.total.energy_consumption", result["csv"])

    @patch("flask_app.services.composite_building_load_service._build_processor")
    @patch("flask_app.services.composite_building_load_service.pull_composite_time_series")
    def test_multiple_building_types_uses_composite_path(self, mock_pull_composite, mock_build_processor):
        processor = MagicMock()
        processor.process_metadata.return_value = pd.DataFrame(
            {
                "bldg_id": [101, 202],
                "in.sqft..ft2": [35000, 15000],
                "out.site_energy.total.energy_consumption..kwh": [537520, 230365],
            }
        )
        mock_build_processor.return_value = processor
        mock_pull_composite.return_value = (
            _SAMPLE_TIME_SERIES,
            {
                ("comstock", "SmallOffice"): _SAMPLE_TIME_SERIES,
                ("comstock", "RetailStripmall"): _SAMPLE_TIME_SERIES.assign(bldg_id=202),
            },
        )

        result = pull_building_load_profile(
            _load_profile_properties(
                espm_building_type_primary_weight=70,
                espm_building_type_secondary="Strip Mall",
                espm_building_type_secondary_weight=30,
            )
        )

        mock_pull_composite.assert_called_once()
        self.assertEqual(len(result["components"]), 2)
        self.assertAlmostEqual(sum(c["fraction"] for c in result["components"]), 1.0)
        self.assertEqual([building["building_id"] for building in result["representative_buildings"]], ["101", "202"])

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_output_remains_at_native_interval(self, mock_pull_single):
        mock_pull_single.return_value = (_SAMPLE_TIME_SERIES, _SAMPLE_SELECTION_AUDIT)

        result = pull_building_load_profile(_load_profile_properties(), resample="hourly")

        self.assertEqual(result["row_count"], 4)

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_allows_missing_floor_area_and_eui(self, mock_pull_single):
        random_audit = {
            **_SAMPLE_SELECTION_AUDIT,
            "selection_method": "random_interquartile",
            "target_floor_area_ft2": None,
            "target_site_eui_kbtu_ft2": None,
            "floor_area_relative_difference_pct": None,
            "site_eui_relative_difference_pct": None,
            "combined_relative_distance": None,
            "eligible_candidate_count": 50,
        }
        mock_pull_single.return_value = (_SAMPLE_TIME_SERIES, random_audit)

        result = pull_building_load_profile(
            {"state": "CO", "espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": 100}
        )

        mock_pull_single.assert_called_once_with("comstock", "SmallOffice", "CO", "All", None, None)
        self.assertEqual(result["representative_buildings"][0]["selection_method"], "random_interquartile")


class TestRepresentativeSelection(unittest.TestCase):
    def test_selects_global_minimum_and_returns_auditable_score(self):
        metadata = pd.DataFrame(
            {
                "bldg_id": [10, 20, 30],
                "in.sqft..ft2": [50000, 48000, 70000],
                # Converts to EUIs of roughly 80, 51, and 52 kBtu/ft2 respectively.
                "out.site_energy.total.energy_consumption..kwh": [1172283, 717437, 1066789],
            }
        )

        selected = _select_representative_metadata_row(metadata, target_sqft=50000, target_eui=52)

        self.assertEqual(selected["bldg_id"], 20)
        self.assertEqual(selected["_candidate_count"], 3)
        scores = (metadata["in.sqft..ft2"] - 50000).abs() / 50000 + (
            (metadata["out.site_energy.total.energy_consumption..kwh"] * 3.412141633 / metadata["in.sqft..ft2"]) - 52
        ).abs() / 52
        self.assertEqual(selected["_selection_score"], scores.min())

    def test_uses_only_floor_area_when_eui_target_is_missing(self):
        metadata = pd.DataFrame(
            {
                "bldg_id": [10, 20],
                "in.sqft..ft2": [50000, 80000],
                "out.site_energy.total.energy_consumption..kwh": [1465354, 2344566],
            }
        )

        selected = _select_representative_metadata_row(metadata, target_sqft=52000, target_eui=None)

        self.assertEqual(selected["bldg_id"], 10)
        self.assertEqual(selected["_selection_method"], "floor_area_only")

    def test_uses_only_eui_when_floor_area_target_is_missing(self):
        metadata = pd.DataFrame(
            {
                "bldg_id": [10, 20],
                "in.sqft..ft2": [50000, 80000],
                "out.site_energy.total.energy_consumption..kwh": [1465354, 1211459],
            }
        )

        selected = _select_representative_metadata_row(metadata, target_sqft=None, target_eui=52)

        self.assertEqual(selected["bldg_id"], 20)
        self.assertEqual(selected["_selection_method"], "eui_only")

    @patch("flask_app.services.composite_building_load_service.secrets.randbelow", return_value=1)
    def test_random_fallback_selects_only_from_interquartile_candidates(self, mock_randbelow):
        metadata = pd.DataFrame(
            {
                "bldg_id": list(range(1, 9)),
                "in.sqft..ft2": [10000 * value for value in range(1, 9)],
                "out.site_energy.total.energy_consumption..kwh": [10000 * value * (30 + value * 5) / 3.412141633 for value in range(1, 9)],
            }
        )

        selected = _select_representative_metadata_row(metadata, target_sqft=None, target_eui=None)

        self.assertEqual(selected["bldg_id"], 4)
        self.assertEqual(selected["_selection_method"], "random_interquartile")
        self.assertEqual(selected["_eligible_candidate_count"], 4)
        mock_randbelow.assert_called_once_with(4)


class TestPullBuildingLoadProfiles(unittest.TestCase):
    """Tests for the batch entry point pull_building_load_profiles()."""

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_isolates_failures_per_building(self, mock_pull_single):
        mock_pull_single.return_value = (_SAMPLE_TIME_SERIES, _SAMPLE_SELECTION_AUDIT)

        buildings = [
            {
                "id": "1",
                "properties": _load_profile_properties(),
            },
            {"id": "2", "properties": {"state": ""}},  # missing state -> should fail without affecting building 1
        ]

        with TemporaryDirectory() as output_dir:
            results = pull_building_load_profiles(buildings, output_dir=Path(output_dir))

        self.assertEqual(len(results), 2)
        self.assertTrue(results[0]["success"])
        self.assertTrue(Path(results[0]["file_path"]).is_absolute())
        self.assertFalse(results[1]["success"])
        self.assertIn("state", results[1]["error"])

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_saves_successful_profile_in_requested_output_directory(self, mock_pull_single):
        mock_pull_single.return_value = (_SAMPLE_TIME_SERIES, _SAMPLE_SELECTION_AUDIT)

        with TemporaryDirectory() as output_dir:
            results = pull_building_load_profiles(
                [
                    {
                        "id": "building/1",
                        "properties": _load_profile_properties(street_address="123 Main St."),
                    }
                ],
                resample="hourly",
                output_dir=Path(output_dir),
            )

            saved_path = Path(results[0]["file_path"])
            self.assertEqual(saved_path.parent, Path(output_dir).resolve())
            self.assertEqual(saved_path.name, "123_Main_St_building_1_buildstock_101_hourly_load_profile.csv")
            self.assertEqual(saved_path.read_text(encoding="utf-8"), results[0]["csv"])

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_unexpected_exception_is_caught_and_reported(self, mock_pull_single):
        mock_pull_single.side_effect = RuntimeError("boom")

        results = pull_building_load_profiles(
            [
                {
                    "id": "1",
                    "properties": _load_profile_properties(),
                }
            ]
        )

        self.assertFalse(results[0]["success"])
        self.assertIn("Unexpected error", results[0]["error"])


if __name__ == "__main__":
    unittest.main()
