# Covered Buildings List Web Tool

The Covered Buildings List (CBL) Web Tool is a web-based application to enhance user building data with additional sources, give user tools to edit this mix of data, and export a clean Covered Buildings List for a new building efficiency program in their district, jurisdiction, or community.

There are multiple workflows for generating or validating a covered buildings list including:

- Starting from scratch and leverage open data sources to gather as much data as possible including OpenStreetMap and Microsoft Footprint data
- City-level data available from ArcGIS (or similar) platform that can be exported and imported into the CBL Web Tool for cleaning, validating, and enhancing (add additional data sources, geospatially merge, etc.)
- Existing benchmarking or efficiency programming data, including existing CBLs. The CBL Web Tool can import and clean, validate, and enhance (add additional data sources, geospatially merge, etc.)
- Data normalization and geocoding given a list of addresses uploaded in JSON, CSV, or Excel format.

## Geocoding Workflow

- Normalize each address
- Geocode each address via Amazon Location Services to a lat/long coordinate
- Download the [Microsoft Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints/) for all areas encompassed by the geocoded coordinates
- Find the footprint that intersects (or is closest to) each geocoded coordinate
- Generate the UBID for each footprint
- Display the results of the workflow in a table on the webpage or export the resulting data as csv and GeoJSON

## Developing the CBL Web Tool

### Prerequisites

### CBL Workflow package

The CBL Web Tool depends on a general [Building Data Utilities package](https://github.com/SEED-platform/building-data-utilities). For development, it is recommended to checkout this dependency locally at the same directory level as the cbl-web-tool. The package will be automatically installed when running poetry update in the CBL web tool.

```bash
git clone git@github.com:SEED-platform/building-data-utilities.git
```

#### flask_app

1. Create a MapBox account and create new key, a free tier should suffice <https://www.mapbox.com/>

2. Create an Amazon Location Services account and create a new key, a free tier should suffice <https://aws.amazon.com/location/>

3. A virtual environment is recommended. create a Virtual Environment in the root directory. Run either `python -m venv myenv` or `pyenv virtualenv 3.12.7 venv-name` or `source myenv/bin/activate` (macOS/Linux) or `myenv\Scripts\activate` (Windows) to enter your virtual environment.

4. Install poetry in your virtual environment with `pip install poetry`

5. Install dependencies in your virtual environment with `poetry install`

6. Change to the **flask_app** directory

7. Create a .env file with your Amazon Location Services API key in the following format. You will also need to specify the Amazon base url. If none is specified, the following will be used: https://places.geo.us-east-2.api.aws/v2. For NREL gateway, you will also need to specify an APP ID. For NREL users using the rate-limited key, use the following as the AMAZON_BASE_URL: https://developer.nrel.gov/api/tada/amazon-location-service/places/v2. Due to the nature of this application, we are passing IntendedUse=Storage to the Amazon Location Services API. This results in a slightly higher rate per transaction, but allows us to store the results.

```dotenv
  AMAZON_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  AMAZON_BASE_URL=XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  AMAZON_APP_ID=XXXXXXXXX
```

Note that if an environment key for AMAZON_API_KEY, AMAZON_BASE_URL, and AMAZON_APP_ID exists in your profile, then it will use your environment's key over the .env file. AMAZON_APP_ID can be omitted if you are using the default Amazon URL (it is only needed when using the NREL Gateway).

#### angular-app

1. Change to the **angular-app** directory

2. Install `nvm` (macos: `brew install nvm`)

3. Ensure you are running Node v22.13.1: `node -v`, if not run `nvm install 22.13.1`
4. Ensure you are running Node v22.13.1: `node -v`, if not run `nvm install 22.13.1`

5. Set your `.nvmrc` file to use the correct nvm version: `echo "22.14.0" > .nvmrc`

6. Install angular's CLI (v20) in a global location by running `npm install -g @angular/cli@20`

7. Copy the environment template in `angular-app/src/environments/environment.ts.template` to a new file named `angular-app/src/environments/environment.ts`. Replace the mapboxToken with your own.

### Running the Web App

1. Run the web app by opening two terminals:

   - One in the root directory (or angular-app directory) and running `npm start` to start the Angular development server
   - Another with the working directory as flask_app (in your virtual environment) and running `python app.py`

2. After connecting to the web application using the following link <http://localhost:4200/>, upload a file in the format of a json (example below) or excel/csv with columns for street_address, city, and state:

   ```json
   [
     {
       "street_address": "100 W 14th Ave Pkwy",
       "city": "Denver",
       "state": "CO"
     },
     {
       "street_address": "200 E Colfax Ave",
       "city": "Denver",
       "state": "CO"
     },
     {
       "street_address": "320 W Colfax Ave",
       "city": "Denver",
       "state": "CO"
     }
   ]
   ```

3. Once the file is uploaded and your data appears in a table on the web page, click the `Check Data` button to ensure that the data in the file meets the format requirements for the tool. There are three required column names that can be edited in the table: street_address, city, and state.

4. If the data conforms to the data check requirements, a button labeled `Run CBL Workflow` will appear. Click this button to generate a covered buildings list. Note: it will take some time to generate the list and display it.

5. Once the list is generated, a table and map with highlighted building footprints will appear side-by-side on the web page. In this menu, there are a multitude of functions to utilize:
   - The user can select on a row in the table and fly to a specific building, as well as edit data in the rows of the table.
   - A footprint can be manually edited/redrawn by double-clicking on an existing footprint and dragging any of the polygon's vertices.
   - For a specific piece of data, if a row is selected, the user can click the trashcan icon on the map and remove the footprint corresponding to that row in the table. A new footprint for this row can be redrawn using the pencil icon and the data in the row will be automatically updated.
   - The user can reverse geocode/add a new building using the building icon on the map and drawing a new footprint at the desired location. This will add a new entry to the table.
   - The user can also delete data entirely from the map and the table by selecting the row on the table and clicking the `Delete Selected Row` button.

### Features

- **Export** - exports table data to XLSX, CSV, JSON, or GeoJSON formats. Exports only the **filtered/visible rows** from the table instead of all data. This provides a much more useful workflow when working with numerical filters and other data filtering tools.
- **Filtering** - comprehensive filtering on table columns including numerical filtering (>=, <=, etc) with full operator support for mathematical comparisons
- **Column Stats** - provides statistics about % populated for each column, allows user to delete columns and merge columns together
- **Edit Headers** - allows user to update the names of each column, either the display names or the underlying machine names
- **Merge Records** - merges 2 rows together, specify which data to prefer when conflicts arise
- **Bulk Edit** - allows user to set a column to a specific value across multiple selected records
- **Assign Target EUI** - given a few populated fields in the table (in order of importance: building type, climate zone, gross floor area, year built, and weekly hours of operation), a lookup is made on the ESPM data explorer data to retrieve an estimate P25 EUI. See the [ESPM data readme](flask_app/esmp_data/README.md) for more information.
- **Heat Map** - allows user to select a numerical field in the table and use it to apply a heat map to the footprints on the map
- **Interactive Map & Table Integration** - click on table rows to fly to buildings on the map, click on map footprints to select corresponding table rows
- **Footprint Editing** - manually edit/redraw building footprints by double-clicking and dragging polygon vertices on the map
- **Map Drawing Tools** - add new building footprints using the building icon, delete footprints using the trash icon, edit footprints using the pencil icon
- **Reverse Geocoding** - convert building footprints or addresses back to address information using Amazon Location Services API
- **Row Management** - add new rows manually, delete selected rows, with full table-map synchronization
- **Data Validation** - check uploaded data format and requirements before processing
- **Multi-Data Source Support** - load and combine Microsoft Building Footprints and OpenStreetMap building data
- **Map Workflow** - location-based workflow to draw polygons and fetch building footprints from external data sources

### Future Ideas

- supporting multiple files
- flagging duplicate buildings, selecting which building to use (in some cases a dataset will have different building boundaries)
- adding building heights from heuristics and multiple datasets
- reimporting CBL lists

## Development

- run precommit before pushing to the repo
  `poetry run pre-commit run --all-files`

## Development

- run precommit before pushing to the repo
  `poetry run pre-commit run --all-files`

## Releasing

- These instructions are not yet complete
- Release CBL workflow
- Update this repo's `pyproject.toml` to point to the building-data-utilities version on PyPi
- Update CHANGELOG by running auto generation on GitHub.
- Tag on GitHub

## Disclaimer

When using this tool with the Amazon Location Services geocoding API (or any other geocoder) always confirm that the terms of service allow for using and storing geocoding results (as with the Amazon Location Services).
