"""
Tests for the composite building load profile service.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pandas as pd
import pytest

from flask_app.services.composite_building_load_service import (
    CompositeBuildingLoadError,
    _building_type_slots,
    _resolve_components,
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
        mock_pull_single.return_value = _SAMPLE_TIME_SERIES

        result = pull_building_load_profile(
            {
                "state": "co",
                "espm_building_type_primary": "Bank Branch",
                "espm_building_type_primary_weight": 100,
            }
        )

        mock_pull_single.assert_called_once()
        self.assertEqual(result["state"], "CO")
        self.assertEqual(result["row_count"], 4)
        self.assertEqual(len(result["components"]), 1)
        self.assertEqual(result["components"][0]["buildstock_building_type"], "SmallOffice")
        self.assertEqual(result["representative_buildings"][0]["building_id"], "101")
        self.assertIn("out.electricity.total.energy_consumption", result["csv"])

    @patch("flask_app.services.composite_building_load_service.pull_composite_time_series")
    def test_multiple_building_types_uses_composite_path(self, mock_pull_composite):
        mock_pull_composite.return_value = (
            _SAMPLE_TIME_SERIES,
            {
                ("comstock", "SmallOffice"): _SAMPLE_TIME_SERIES,
                ("comstock", "RetailStripmall"): _SAMPLE_TIME_SERIES.assign(bldg_id=202),
            },
        )

        result = pull_building_load_profile(
            {
                "state": "CO",
                "espm_building_type_primary": "Bank Branch",
                "espm_building_type_primary_weight": 70,
                "espm_building_type_secondary": "Strip Mall",
                "espm_building_type_secondary_weight": 30,
            }
        )

        mock_pull_composite.assert_called_once()
        self.assertEqual(len(result["components"]), 2)
        self.assertAlmostEqual(sum(c["fraction"] for c in result["components"]), 1.0)
        self.assertEqual([building["building_id"] for building in result["representative_buildings"]], ["101", "202"])

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_hourly_resample_reduces_row_count(self, mock_pull_single):
        # 4 rows at 15-minute intervals within the same hour should resample down to 1 hourly row.
        mock_pull_single.return_value = _SAMPLE_TIME_SERIES

        result = pull_building_load_profile(
            {"state": "CO", "espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": 100},
            resample="hourly",
        )

        self.assertEqual(result["row_count"], 1)


class TestPullBuildingLoadProfiles(unittest.TestCase):
    """Tests for the batch entry point pull_building_load_profiles()."""

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_isolates_failures_per_building(self, mock_pull_single):
        mock_pull_single.return_value = _SAMPLE_TIME_SERIES

        buildings = [
            {
                "id": "1",
                "properties": {"state": "CO", "espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": 100},
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
        mock_pull_single.return_value = _SAMPLE_TIME_SERIES

        with TemporaryDirectory() as output_dir:
            results = pull_building_load_profiles(
                [
                    {
                        "id": "building/1",
                        "properties": {
                            "street_address": "123 Main St.",
                            "state": "CO",
                            "espm_building_type_primary": "Bank Branch",
                            "espm_building_type_primary_weight": 100,
                        },
                    }
                ],
                resample="hourly",
                output_dir=Path(output_dir),
            )

            saved_path = Path(results[0]["file_path"])
            self.assertEqual(saved_path.parent, Path(output_dir).resolve())
            self.assertEqual(saved_path.name, "123_Main_St_building_1_hourly_load_profile.csv")
            self.assertEqual(saved_path.read_text(encoding="utf-8"), results[0]["csv"])

    @patch("flask_app.services.composite_building_load_service._pull_single_component_time_series")
    def test_unexpected_exception_is_caught_and_reported(self, mock_pull_single):
        mock_pull_single.side_effect = RuntimeError("boom")

        results = pull_building_load_profiles(
            [
                {
                    "id": "1",
                    "properties": {"state": "CO", "espm_building_type_primary": "Bank Branch", "espm_building_type_primary_weight": 100},
                }
            ]
        )

        self.assertFalse(results[0]["success"])
        self.assertIn("Unexpected error", results[0]["error"])


if __name__ == "__main__":
    unittest.main()
