# Square One

Square One is a web-based application to enhance user building data with additional sources, give user tools to edit this mix of data, and export a clean Square One list for a new building efficiency program in their district, jurisdiction, or community.

There are multiple workflows for generating or validating a Square One list including:

- Starting from scratch and leverage open data sources to gather as much data as possible including OpenStreetMap and Microsoft Footprint data
- City-level data available from ArcGIS (or similar) platform that can be exported and imported into Square One for cleaning, validating, and enhancing (add additional data sources, geospatially merge, etc.)
- Existing benchmarking or efficiency programming data, including existing building lists. Square One can import and clean, validate, and enhance (add additional data sources, geospatially merge, etc.)
- Data normalization and geocoding given a list of addresses uploaded in JSON, CSV, or Excel format.

## Geocoding Workflow

- Normalize each address
- Geocode each address via Amazon Location Services to a lat/long coordinate
- Download the [Microsoft Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints/) for all areas encompassed by the geocoded coordinates
- Find the footprint that intersects (or is closest to) each geocoded coordinate
- Generate the UBID for each footprint
- Display the results of the workflow in a table on the webpage or export the resulting data as csv and GeoJSON

## Getting Started

Square One has two on-ramps depending on what data you're starting with. **Start with Level 1** — it's the fastest way to get the app running and requires no third-party API keys except a free Mapbox token (needed just to render the map). Only move to Level 2 if your data doesn't already have coordinates and you need Square One to geocode addresses for you.

### Prerequisites (both levels)

- [git](https://git-scm.com/)
- Python 3.10–3.12 and [poetry](https://python-poetry.org/) (`pip install poetry`)
- Node v22.13.1+ and npm (using [nvm](https://github.com/nvm-sh/nvm) is recommended: `brew install nvm`, then `nvm install 22.13.1`)
- Square One depends on a general [Building Data Utilities package](https://github.com/SEED-platform/building-data-utilities). Check it out locally at the same directory level as `square-one` — it's picked up automatically when installing dependencies below.

  ```bash
  git clone git@github.com:SEED-platform/building-data-utilities.git
  ```

### Level 1 — Quick Start: uploading your own lat/long data

Use this path if your building list already has (or can easily have) `latitude`/`longitude` columns. **No Amazon Location Services key is required** — rows with valid coordinates skip geocoding entirely and go straight to building footprint matching.

1. Create a virtual environment in the repo root and activate it: `python -m venv myenv` then `source myenv/bin/activate` (macOS/Linux) or `myenv\Scripts\activate` (Windows).

2. Install Python dependencies: `pip install poetry && poetry install`

3. Create a free [Mapbox](https://www.mapbox.com/) account and access token (only used to draw the base map). Copy the environment template and add your token:

   ```bash
   cp angular-app/src/environments/environment.ts.template angular-app/src/environments/environment.ts
   ```

   Then edit `angular-app/src/environments/environment.ts` and replace `REPLACE_WITH_YOUR_MAPBOX_TOKEN` with your token.

4. Install Node dependencies from the repo root (this also installs the Angular app's dependencies via npm workspaces): `npm install`

5. Start the app in two terminals:

   - Terminal 1 (repo root): `npm start` — starts the Angular dev server
   - Terminal 2 (repo root, with your Python virtual environment active): `npm run start:python` — starts the Flask API

6. Open <http://localhost:4201/> and upload a JSON, CSV, or Excel file with a `latitude` and `longitude` column for each building (an address, e.g. `street_address`/`city`/`state`, is still recommended for display/reference, but geocoding is skipped when coordinates are already present):

   ```json
   [
     {
       "street_address": "100 W 14th Ave Pkwy",
       "city": "Denver",
       "state": "CO",
       "latitude": 39.7407,
       "longitude": -104.9995
     }
   ]
   ```

7. Click `Check Data`, then `Run Square One Workflow`. That's it — you're up and running.

### Level 2 — Next step: geocoding addresses (no lat/long yet)

If your data only has addresses (no coordinates), Square One can geocode them for you via Amazon Location Services (a free tier is sufficient). This is the only feature that requires an additional key beyond Level 1.

1. Create an [Amazon Location Services](https://aws.amazon.com/location/) account and API key.

2. In the `flask_app` directory, create a `.env` file:

   ```dotenv
   AMAZON_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   AMAZON_BASE_URL=XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   AMAZON_APP_ID=XXXXXXXXX
   ```

   - `AMAZON_BASE_URL` defaults to `https://places.geo.us-east-2.api.aws/v2` if omitted.
   - `AMAZON_APP_ID` is only needed for the NLR Gateway (rate-limited key), in which case use `AMAZON_BASE_URL=https://developer.nlr.gov/api/tada/amazon-location-service/places/v2`.
   - Environment variables already set in your shell/profile take precedence over the `.env` file.
   - Due to the nature of this application, requests pass `IntendedUse=Storage` to the Amazon Location Services API, which allows storing geocoding results (see [Disclaimer](#disclaimer)) at a slightly higher rate per transaction.

3. Restart the Flask app. Now you can upload a file with just `street_address`, `city`, and `state` (no coordinates needed) and Square One will geocode each row automatically.

### Using the App

Once the file you uploaded (see **Level 1** or **Level 2** above) appears in a table on the web page:

1. Click the `Check Data` button to ensure that the data in the file meets the format requirements for the tool. There are three required column names that can be edited in the table: street_address, city, and state.

2. If the data conforms to the data check requirements, a button labeled `Run Square One Workflow` will appear. Click this button to generate a Square One list. Note: it will take some time to generate the list and display it.

3. Once the list is generated, a table and map with highlighted building footprints will appear side-by-side on the web page. In this menu, there are a multitude of functions to utilize:
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
- reimporting Square One lists

## Development

- run precommit before pushing to the repo
  `poetry run pre-commit run --all-files`

## Releasing

- These instructions are not yet complete
- Release Square One workflow
- Update this repo's `pyproject.toml` to point to the building-data-utilities version on PyPi
- Update CHANGELOG by running auto generation on GitHub.
- Tag on GitHub

## Disclaimer

When using this tool with the Amazon Location Services geocoding API (or any other geocoder) always confirm that the terms of service allow for using and storing geocoding results (as with the Amazon Location Services).
