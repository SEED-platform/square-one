# How to Use This Tool

Welcome to the Covered Buildings List Web Tool!

## Mission Statement

The goal of this tool is to enhance your data about buildings with additional sources, give you tools to edit this mix of data, and export a clean Covered Buildings List for a new building efficiency program in your jurisdiction.

## Stages of CBL Workflow

### 1. Upload data

Data can be uploaded into the CBL Web Tool in these formats.

1. Excel spreadsheet: .xlsx
1. Comma-separated values: .csv
1. JavaScript Object Notation: .json
1. Geographic JSON: .geojson

All data will be shown on a map. This means that data must have mappable component. One of the following is required:

1. Street Address. You will have the option of geocoding these street addresses. For the Amazon Location Services geocoder, these fields are required:
   1. street_address
   1. city
   1. state
1. Latitude and Longitude columns
1. Geography column that can be read by GeoPandas. This could consist of building outlines (polygons or multipolygons) or points.

All geographic data must be in the projection EPSG:4326.

### 2. Clean and enhance data

1.  Left nav that lists the files uploaded
1.  Set the “base” file
1.  Rename columns
1.  If addresses provided:
    1. Normalize
    1. Geocode
    1. Pick geocoding service and provide credentials

### 3. Add public data

In this step, you will have the option to download building footprints from the [Microsoft Footprints dataset](https://github.com/microsoft/GlobalMLBuildingFootprints).

Data source is loaded and buildings near the user data saved in memory

### 4. Edit data on map

1.  All user data and selected public data on same map
1.  Select options
    1.  Select buildings by data row
    1.  Select buildings by mouse-drawn circle or rectangle or freeform
1.  Edit options
    1.  Resize footprint
    1.  Delete footprint / building
    1.  Split footprint into multiple buildings
    1.  Edit metadata associated with a building
    1.  Merge footprints
1.  Button to upload another file from the map

### 5. Export

1.  One finished table
1.  Option to create UBIDs for output shapes
1.  Note the provenance of each field and record
    1.  Field
        1.  Data source
    1.  Record
        1.  Manually edited or not
        1.  Source, from a user upload or national data source
1.  Export in CSV or GeoJSON
