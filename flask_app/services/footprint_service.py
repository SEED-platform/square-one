"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import gzip
import logging
from pathlib import Path

import geopandas as gpd
import mercantile
import numpy as np
import osmnx as ox
import pandas as pd
from cbl_workflow.utils.ubid import centroid, encode_ubid
from cbl_workflow.utils.update_dataset_links import update_dataset_links
from cbl_workflow.utils.update_quadkeys import update_quadkeys
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

import flask_app.config as config


class FootprintService:
    def _get_best_area_crs(self, gdf):
        """
        Select the best CRS for area calculation based on centroid location.
        Returns an EPSG code.
        """
        centroid = gdf.geometry.union_all().centroid
        lon, lat = centroid.x, centroid.y
        # Alaska
        if lat > 50 and lon < -130:
            return 3338  # Alaska Albers Equal Area
        # Hawaii
        if 18 <= lat <= 23 and -162 <= lon <= -154:
            return 3563  # Hawaii Albers Equal Area
        # Contiguous US
        if 24 <= lat <= 50 and -125 <= lon <= -66:
            return 5070  # USA Contiguous Albers Equal Area
        # Fallback: UTM zone based on longitude
        utm_zone = int((lon + 180) / 6) + 1
        is_northern = lat >= 0
        epsg = 32600 + utm_zone if is_northern else 32700 + utm_zone
        return epsg

    """Service class for handling footprint operations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.data_dir = Path(config.data_dir)
        self.quadkeys_dir = self.data_dir / "quadkeys"

    def get_quadkeys_for_polygon(self, polygon: Polygon) -> list[int]:
        """
        Get quadkeys that intersect with the given polygon.

        Args:
            polygon: Shapely Polygon object

        Returns:
            List of quadkey integers
        """
        try:
            # Create GeoDataFrame for the area of interest
            aoi_gdf = gpd.GeoDataFrame([{"geometry": polygon}], crs="EPSG:4326")

            # Get bounds of the area of interest
            bounds = aoi_gdf.bounds.iloc[0]
            minx, miny, maxx, maxy = bounds["minx"], bounds["miny"], bounds["maxx"], bounds["maxy"]

            # Get quadkeys for the area
            quadkeys = set()
            for tile in list(mercantile.tiles(minx, miny, maxx, maxy, zooms=9)):
                quadkeys.add(int(mercantile.quadkey(tile)))

            quadkeys_list = list(quadkeys)
            self.logger.info(f"The input area spans {len(quadkeys_list)} tiles: {quadkeys_list}")

            return quadkeys_list
        except Exception as e:
            self.logger.error(f"Error getting quadkeys for polygon: {e}")
            raise

    def update_datasets(self, quadkeys: list[int]) -> None:
        """
        Update dataset links and quadkeys.

        Args:
            quadkeys: List of quadkey integers
        """
        try:
            update_dataset_links(save_directory=self.quadkeys_dir)
            update_quadkeys(quadkeys, self.quadkeys_dir)
            self.logger.info("Dataset links and quadkeys updated successfully")
        except Exception as e:
            self.logger.error(f"Error updating dataset links/quadkeys: {e}")
            raise

    def load_ms_footprints(self, polygon: Polygon, quadkeys: list[int]) -> gpd.GeoDataFrame:
        """
        Load Microsoft footprints for the given polygon and quadkeys.

        Args:
            polygon: Shapely Polygon object defining the area of interest
            quadkeys: List of quadkey integers

        Returns:
            GeoDataFrame containing Microsoft footprints
        """
        try:
            # Create GeoDataFrame for the area of interest
            aoi_gdf = gpd.GeoDataFrame([{"geometry": polygon}], crs="EPSG:4326")

            # Load and process Microsoft footprints
            idx = 0
            ms_gdf = gpd.GeoDataFrame()
            loaded_quadkeys = {}

            for quadkey in quadkeys:
                if quadkey not in loaded_quadkeys:
                    self.logger.info(f"Loading quadkey id: {quadkey}")
                    quadkey_file = self.quadkeys_dir / f"{quadkey}.geojsonl.gz"

                    if not quadkey_file.exists():
                        self.logger.warning(f"Quadkey file not found: {quadkey_file}")
                        continue

                    try:
                        with gzip.open(quadkey_file, "rb") as f:
                            gdf = gpd.read_file(f)
                            self.logger.info(f"  Quadkey: {quadkey} has {len(gdf)} footprints")

                            # Filter geometries within the area of interest
                            gdf = gdf[gdf.geometry.within(aoi_gdf.geometry.iloc[0])]
                            self.logger.info(f"  Quadkey: {quadkey} has {len(gdf)} footprints within the area of interest")

                            # Save the quadkey to be combined later
                            loaded_quadkeys[quadkey] = gdf

                    except Exception as e:
                        self.logger.error(f"Error loading quadkey {quadkey}: {e}")
                        continue

            # Merge the GeoDataFrames
            for loaded_gdf in loaded_quadkeys.values():
                loaded_gdf["id"] = range(idx, idx + len(loaded_gdf))
                idx += len(loaded_gdf)
                ms_gdf = pd.concat([ms_gdf, loaded_gdf], ignore_index=True)

            if len(ms_gdf) == 0:
                self.logger.warning("No Microsoft footprints found in the area")
                return gpd.GeoDataFrame()

            self.logger.info(f"Total Microsoft footprints found: {len(ms_gdf)}")
            return ms_gdf

        except Exception as e:
            self.logger.error(f"Error loading Microsoft footprints: {e}")
            raise

    def process_ms_footprints(self, ms_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Process Microsoft footprints data.

        Args:
            ms_gdf: GeoDataFrame with Microsoft footprints

        Returns:
            Processed GeoDataFrame
        """
        try:
            # Handle -1 heights
            ms_gdf["height"] = ms_gdf["height"].apply(lambda x: x if x != -1 else None)

            # Add UBIDs
            ms_gdf["ubid"] = ms_gdf.apply(lambda x: encode_ubid(x["geometry"]), axis=1)
            ms_gdf["ubid_centroid"] = ms_gdf.apply(lambda x: centroid(x["ubid"]), axis=1)

            # Decompose the ubid_centroid into lat/long
            ms_gdf["longitude"] = ms_gdf["ubid_centroid"].apply(lambda point: point.x)
            ms_gdf["latitude"] = ms_gdf["ubid_centroid"].apply(lambda point: point.y)
            ms_gdf = ms_gdf.drop(columns=["ubid_centroid"])

            # Calculate footprint area using best CRS for the region
            if ms_gdf.crs is None:
                ms_gdf = ms_gdf.set_crs(epsg=4326)
            best_crs = self._get_best_area_crs(ms_gdf)
            ms_gdf_proj = ms_gdf.to_crs(epsg=best_crs)
            ms_gdf["footprint_area_m2"] = ms_gdf_proj.area
            ms_gdf["footprint_area_ft2"] = ms_gdf["footprint_area_m2"] * 10.764
            # Return to 4326 for further processing
            ms_gdf = ms_gdf.to_crs(epsg=4326)

            # Add address fields in the format expected by the frontend
            ms_gdf["street_address"] = ""
            ms_gdf["city"] = ""
            ms_gdf["state"] = ""
            ms_gdf["postal_code"] = ""
            ms_gdf["country"] = ""

            # Set the source of the data to "Microsoft Footprints"
            ms_gdf["source"] = "Microsoft Footprints"

            self.logger.info(f"Processed Microsoft footprints: {len(ms_gdf)} final footprints")
            return ms_gdf

        except Exception as e:
            self.logger.error(f"Error processing Microsoft footprints: {e}")
            raise

    def load_osm_footprints(self, polygon: Polygon) -> gpd.GeoDataFrame:
        """
        Load OpenStreetMap footprints for the given polygon.

        Args:
            polygon: Shapely Polygon object defining the area of interest

        Returns:
            GeoDataFrame containing OSM footprints
        """
        try:
            # Get OSM footprints
            osm_gdf = ox.features_from_polygon(polygon, tags={"building": True})

            if len(osm_gdf) == 0:
                self.logger.warning("No OSM footprints found in the area")
                return gpd.GeoDataFrame()

            self.logger.info(f"Total OSM footprints found: {len(osm_gdf)}")
            return osm_gdf

        except Exception as e:
            self.logger.error(f"Error loading OSM footprints: {e}")
            raise

    def process_osm_footprints(self, osm_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Process OpenStreetMap footprints data.

        Args:
            osm_gdf: GeoDataFrame with OSM footprints

        Returns:
            Processed GeoDataFrame
        """
        try:
            # Convert to GeoDataFrame if it's not already
            if not isinstance(osm_gdf, gpd.GeoDataFrame):
                osm_gdf = gpd.GeoDataFrame(osm_gdf)

            # Filter out point geometries (we only want polygons)
            osm_gdf = osm_gdf[osm_gdf.geometry.geom_type != "Point"].copy()

            # Reset index to add unique IDs
            osm_gdf = osm_gdf.reset_index()
            osm_gdf["osm_id"] = osm_gdf["id"]
            osm_gdf["id"] = range(len(osm_gdf))

            # Log the columns to help debug
            self.logger.debug(f"OSM DataFrame columns after reset_index: {osm_gdf.columns.tolist()}")

            # Drop unwanted columns
            drop_cols = ["nodes", "area_right", "centroid", "bounds_minx", "bounds_miny", "bounds_maxx", "bounds_maxy", "ways"]
            drop_cols = [col for col in drop_cols if col in osm_gdf.columns]
            if drop_cols:
                osm_gdf = osm_gdf.drop(columns=drop_cols)

            # Add UBIDs
            osm_gdf["ubid"] = osm_gdf.apply(lambda x: encode_ubid(x["geometry"]), axis=1)
            osm_gdf["ubid_centroid"] = osm_gdf.apply(lambda x: centroid(x["ubid"]), axis=1)

            # Decompose the ubid_centroid into lat/long
            osm_gdf["longitude"] = osm_gdf["ubid_centroid"].apply(lambda point: point.x)
            osm_gdf["latitude"] = osm_gdf["ubid_centroid"].apply(lambda point: point.y)
            osm_gdf = osm_gdf.drop(columns=["ubid_centroid"])

            # Calculate footprint area using best CRS for the region
            if osm_gdf.crs is None:
                osm_gdf = osm_gdf.set_crs(epsg=4326)
            best_crs = self._get_best_area_crs(osm_gdf)
            osm_gdf_proj = osm_gdf.to_crs(epsg=best_crs)
            osm_gdf["footprint_area_m2"] = osm_gdf_proj.area
            osm_gdf["footprint_area_ft2"] = osm_gdf["footprint_area_m2"] * 10.764
            # Return to 4326 for further processing
            osm_gdf = osm_gdf.to_crs(epsg=4326)

            # Set the source of the data to "OpenStreetMap"
            osm_gdf["source"] = "OpenStreetMap"

            # Add OSM URL - handle different possible column names after reset_index
            def create_url_field(row):
                try:
                    # Common patterns after reset_index with OSMnx data
                    if "element" in row and "osm_id" in row:
                        return f"https://www.openstreetmap.org/{row['element']}/{row['osm_id']}"
                    elif "level_0" in row and "level_1" in row:
                        return f"https://www.openstreetmap.org/{row['level_0']}/{row['level_1']}"
                    # Try direct index access if available
                    elif hasattr(row, "name") and isinstance(row.name, tuple) and len(row.name) >= 2:
                        return f"https://www.openstreetmap.org/{row.name[0]}/{row.name[1]}"
                    # Fallback to generic OSM URL
                    else:
                        return "https://www.openstreetmap.org/"
                except Exception as e:
                    self.logger.warning(f"Could not create OSM URL for row: {e}")
                    return "https://www.openstreetmap.org/"

            osm_gdf["osm_url"] = osm_gdf.apply(create_url_field, axis=1)

            # Clean up building types
            if "building" in osm_gdf.columns:
                # Remove buildings that are just roofs
                osm_gdf = osm_gdf[osm_gdf["building"] != "roof"]

                # If there is an amenity, then make the building the amenity
                if "amenity" in osm_gdf.columns:
                    osm_gdf.loc[osm_gdf["amenity"].notna(), "building"] = osm_gdf["amenity"]

                # Map "yes" buildings to "Unknown"
                osm_gdf.loc[osm_gdf["building"] == "yes", "building"] = "Unknown"

                # save building to building_type
                osm_gdf["building_type"] = osm_gdf["building"]
                # remove building
                osm_gdf = osm_gdf.drop(columns=["building"])

            # Handle height and levels
            if "height" not in osm_gdf.columns:
                osm_gdf["height"] = 0
            else:
                osm_gdf["height"] = osm_gdf["height"].fillna(0)

            if "building:levels" in osm_gdf.columns:
                osm_gdf["building:levels"] = osm_gdf["building:levels"].fillna(0)
                osm_gdf["building:levels"] = osm_gdf["building:levels"].astype(int)

            # Process address fields
            self._process_osm_address_fields(osm_gdf)

            self.logger.info(f"Processed OSM footprints: {len(osm_gdf)} final footprints")
            return osm_gdf

        except Exception as e:
            self.logger.error(f"Error processing OSM footprints: {e}")
            raise

    def _process_osm_address_fields(self, osm_gdf: gpd.GeoDataFrame) -> None:
        """
        Process address fields for OSM footprints.

        Args:
            osm_gdf: GeoDataFrame to process (modified in place)
        """
        self.logger.info("Processing address fields...")
        self.logger.debug(f"OSM DataFrame columns: {osm_gdf.columns.tolist()}")

        # Save as CSV for debugging
        osm_gdf.to_csv("osm_footprints_debug.csv", index=False)

        # Process address fields
        if "addr:city" not in osm_gdf.columns:
            osm_gdf["city"] = ""
        else:
            osm_gdf["city"] = osm_gdf["addr:city"].fillna("")

        if "addr:housenumber" not in osm_gdf.columns:
            osm_gdf["addr:housenumber"] = ""
        else:
            osm_gdf["addr:housenumber"] = osm_gdf["addr:housenumber"].fillna("")

        if "addr:street" not in osm_gdf.columns:
            osm_gdf["street"] = ""
        else:
            osm_gdf["street"] = osm_gdf["addr:street"].fillna("")

        if "addr:state" not in osm_gdf.columns:
            osm_gdf["state"] = ""
        else:
            osm_gdf["state"] = osm_gdf["addr:state"].fillna("")

        if "addr:postcode" not in osm_gdf.columns:
            osm_gdf["postal_code"] = ""
        else:
            osm_gdf["postal_code"] = osm_gdf["addr:postcode"].fillna("")

        # Create combined street address
        house_numbers = osm_gdf["addr:housenumber"].astype(str).str.strip()
        streets = osm_gdf["street"].astype(str).str.strip()

        # Combine house number and street, handling empty values
        street_addresses = []
        for house_num, street in zip(house_numbers, streets):
            if house_num and house_num != "nan" and street and street != "nan":
                street_addresses.append(f"{house_num} {street}")
            elif street and street != "nan":
                street_addresses.append(street)
            elif house_num and house_num != "nan":
                street_addresses.append(house_num)
            else:
                street_addresses.append("")

        osm_gdf["street_address"] = street_addresses

        # Add country field
        osm_gdf["country"] = ""

    def merge_footprint_geodataframes(self, gdf_1, gdf_2):
        """
        Merge two footprint GeoDataFrames first by intersection and then dissolve by UBID.

        This method makes assumptions on fields coming from Microsoft Footprint and OpenStreetMap.
        The assumptions probably need to be relaxed in the future and as we support different
        formats of data.

        Returns a GeoDataFrame with merged footprints.
        """
        # Overlay the two GeoDataFrames to get intersection geometries
        overlap_gdf = gpd.overlay(gdf_1, gdf_2, how="intersection")

        # Create a mapping for how each column should be aggregated when dissolving
        # "first" means take the first value found for that column in each group
        column_mapping = dict.fromkeys(overlap_gdf.columns, "first")

        # For some columns, we want to aggregate differently:
        # "unique" will collect all unique values in the group (e.g., if multiple heights or UBIDs)
        for unique_col in ["ubid_2", "height_1", "height_2"]:
            if unique_col in overlap_gdf.columns:
                column_mapping[unique_col] = "unique"

        # Remove columns that are used for grouping or are geometry, since those are handled separately
        column_mapping.pop("ubid_1", None)
        column_mapping.pop("geometry", None)

        # Dissolve merges all rows with the same UBID 1 into a single row, combining their geometries
        # and aggregating the other columns according to column_mapping. This is useful for combining
        # overlapping/intersecting footprints that share the same UBID into a single, unified footprint.
        overlap_gdf = overlap_gdf.dissolve(by="ubid_1", aggfunc=column_mapping).reset_index()

        # Now for the unique column_mapping names, rename to make it clear that they
        # are now lists for posterity sake
        for col in column_mapping:
            overlap_gdf = overlap_gdf.rename(columns={col: f"{col}_list" if column_mapping[col] == "unique" else col})

        # For height, merge the height_1 and height_2 lists
        overlap_gdf["height_list"] = overlap_gdf[["height_1_list", "height_2_list"]].apply(lambda x: list(set(x.dropna().sum())), axis=1)
        # grab the largest height and set to height
        overlap_gdf["height"] = overlap_gdf["height_list"].apply(lambda x: max(x) if x else None)

        # Merge MultiPolygon into a single Polygon if possible
        def merge_or_largest(geom):
            if isinstance(geom, MultiPolygon):
                merged = unary_union(geom)
                if isinstance(merged, Polygon):
                    return merged
                else:
                    largest_polygon = max(geom.geoms, key=lambda p: p.area)
                    return largest_polygon
            return geom

        overlap_gdf["geometry"] = overlap_gdf["geometry"].apply(merge_or_largest)

        # If height_1 is an array, then use the second

        # map the building_type to the values in ESPM. X : Y, X = OSM value, Y = ESPM
        # OpenStreetMap values can be found here: https://wiki.openstreetmap.org/wiki/Key:building
        # The "building" values reported in OSM can be spotty and these assumptions can
        # be improved. We also know that many building types are not what we think they
        # are based on community surveys (e.g., libraries are used for more than reading--they
        # are shelters, internet, offices, etc)
        espm_building_types_enum = {
            "civic": "Public services",
            "apartments": "Lodging/residential",
            # placeholders
            "unknown_1": "Banking/financial services",
            "unknown_2": "Education",
            "unknown_3": "Entertainment/public assembly",
            "unknown_4": "Food sales and service",
            "unknown_5": "Healthcare",
            "unknown_6": "Lodging/residential",
            "unknown_7": "Manufacturing/industrial",
            "unknown_8": "Office",
            "unknown_9": "Other",
            "unknown_10": "Public services",
            "unknown_11": "Religious worship",
            "unknown_12": "Retail",
            "unknown_13": "Services",
            "unknown_14": "Technology/science",
            "unknown_15": "Utility",
            "unknown_16": "Warehouse/storage",
        }

        # look up building type, if it isn't found then just use "All"
        # rename old building_type to OSM first
        if "building_type" in overlap_gdf.columns:
            overlap_gdf = overlap_gdf.rename(columns={"building_type": "building_type_osm"})
        else:
            overlap_gdf["building_type_osm"] = "All"
        overlap_gdf["building_type"] = overlap_gdf["building_type_osm"].map(espm_building_types_enum).fillna("All")

        # Prepend all fields with the source_1, source_2

        # overlap_gdf = overlap_gdf.rename(columns=lambda x: f"source_1_{x}" if x in gdf_1.columns else f"source_2_{x}" for x in overlap_gdf.columns)

        # now recalculate the UBID, floor area, centroid, etc
        overlap_gdf["ubid"] = overlap_gdf.apply(lambda x: encode_ubid(x["geometry"]), axis=1)
        overlap_gdf["ubid_centroid"] = overlap_gdf.apply(lambda x: centroid(x["ubid"]), axis=1)

        # Convert all float columns to native Python float to avoid numpy float64 serialization issues
        for col in overlap_gdf.select_dtypes(include=["float", "float64"]).columns:
            overlap_gdf[col] = overlap_gdf[col].apply(lambda v: float(v) if v is not None else None)

        # Decompose the ubid_centroid into lat/long
        overlap_gdf["longitude"] = overlap_gdf["ubid_centroid"].apply(lambda point: point.x)
        overlap_gdf["latitude"] = overlap_gdf["ubid_centroid"].apply(lambda point: point.y)
        overlap_gdf = overlap_gdf.drop(columns=["ubid_centroid"])

        # Calculate footprint area using best CRS for the region
        if overlap_gdf.crs is None:
            overlap_gdf = overlap_gdf.set_crs(epsg=4326)
        best_crs = self._get_best_area_crs(overlap_gdf)
        overlap_gdf_proj = overlap_gdf.to_crs(epsg=best_crs)
        overlap_gdf["footprint_area_m2"] = overlap_gdf_proj.area
        overlap_gdf["footprint_area_ft2"] = overlap_gdf["footprint_area_m2"] * 10.764
        # Return to 4326 for further processing
        overlap_gdf = overlap_gdf.to_crs(epsg=4326)

        # calculate the number of stories and gross floor area based on a 3.5 meter height
        overlap_gdf["number_of_stories"] = (overlap_gdf["height"] / 3.5).apply(np.ceil).astype(int)
        overlap_gdf["gross_floor_area_m2"] = overlap_gdf["footprint_area_m2"] * overlap_gdf["number_of_stories"]
        overlap_gdf["gross_floor_area_ft2"] = overlap_gdf["gross_floor_area_m2"] * 10.764

        return overlap_gdf
