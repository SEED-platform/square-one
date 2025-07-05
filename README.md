# Covered Buildings List Web Tool

The Covered Buildings List (CBL) Web Tool is a web-based application to enhance user building data with additional sources, give user tools to edit this mix of data, and export a clean Covered Buildings List for a new building efficiency program in their district, jurisdiction, or community.

There are multiple workflows for generating or validating a covered buildings list including:

- Starting from scratch and leverage open data sources to gather as much data as possible including OpenStreetMap and Microsoft Footprint data
- City-level data available from ArcGIS (or similar) platform that can be exported and imported into the CBL Web Tool for cleaning, validating, and enhancing (add additional data sources, geospatially merge, etc.)
- Existing benchmarking or efficiency programming data, including existing CBLs. The CBL Web Tool can import and clean, validate, and enhance (add additional data sources, geospatially merge, etc.)
- Data normalization and geocoding given a list of addresses uploaded in JSON, CSV, or Excel format.

## Geocoding Workflow

- Normalize each address
- Geocode each address via MapQuest to a lat/long coordinate
- Download the [Microsoft Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints/) for all areas encompassed by the geocoded coordinates
- Find the footprint that intersects (or is closest to) each geocoded coordinate
- Generate the UBID for each footprint
- Display the results of the workflow in a table on the webpage or export the resulting data as csv and GeoJSON

## Developing the CBL Web Tool

### Prerequisites

### CBL Workflow package

The CBL Web Tool depends on a general [CBL workflow package](https://github.com/SEED-platform/cbl-workflow). For development, it is recommended to checkout this dependency locally at the same directory level as the cbl-web-tool.

```bash
git clone git@github.com:SEED-platform/cbl-workflow.git
```

The package will be automatically installed when running poetry update in the CBL web tool.

#### flask_app

- Create a MapBox account and create new key, a free tier should suffice <https://www.mapbox.com/>
- Create a MapQuest account and create a new key, a free tier should suffice <https://www.mapquest.com/>

1. A virtual environment is recommended: create a Virtual Environment in the root directory:
   - `python -m venv myenv` or `pyenv virtualenv 3.12.7 venv-name`
   - `source myenv/bin/activate` (macOS/Linux) or `myenv\Scripts\activate` (Windows) to enter your virtual environment
1. Install poetry in your virtual environment with `pip install poetry`
1. Install dependencies in your virtual environment with `poetry install`
1. Change to the **flask_app** directory
1. Create a `.env` file in your MapQuest API key in the format:

   ```dotenv
   MAPQUEST_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

   Note that if an environment key for MAPQUEST_API_KEY exists in your profile, then it will use your environment's key over the .env file.

#### angular-app

1. Change to the **angular-app** directory
1. Install `nvm` (macos: `brew install nvm`)
1. Ensure you are running Node v20.11.1: `node -v`, if not run `nvm install 20.11.1`
1. Install angular and other dependencies by running `npm install`
1. Install angular's CLI in a global location by running `npm install -g @angular/cli@17`
1. Copy the environment template in `angular-app/src/environments/environment.ts.template` to a new file named `angular-app/src/environments/environment.ts`. Replace the mapboxToken with your own.

### Running the Web App

1. Run the web app by opening two terminals: one with the working directory as angular-app and running `ng serve -o` and the other with the working directory as flask_app(in your virtual environment) and running `python app.py`
1. After connecting to the web application using the following link <http://localhost:4200/>, upload a file in the format of a json (example below) or excel/csv with columns for street_address, city, and state:

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

1. Once the file is uploaded and your data appears in a table on the web page, click the `Check Data` button to ensure that the data in the file meets the format requirements for the tool.
   There are three required column names that can be edited in the table: street_address, city, and state
1. If the data conforms to the data check requirements, a button labeled `Run CBL Workflow` will appear. Click this button to generate a covered buildings list. Note: it will take some time to generate the list and display it.
1. Once the list is generated, a table and map with highlighted building footprints will appear side-by-side on the web page. In this menu, there are a multitude of functions to utilize:

   - The user can select on a row in the table and fly to a specific building, as well as edit data in the rows of the table.
   - A footprint can be manually edited/redrawn by double-clicking on an existing footprint and dragging any of the polygon's vertices.
   - For a specific piece of data, if a row is selected, the user can click the trashcan icon on the map and remove the footprint corresponding to that row in the table. A new footprint for this row can be redrawn using the pencil icon and the data in the row will be automatically updated.
   - The user can reverse geocode/add a new building using the building icon on the map and drawing a new footprint at the desired location. This will add a new entry to the table.
   - The user can also delete data entirely from the map and the table by selecting the row on the table and clicking the `Delete Selected Row` button.

### Future Ideas

- supporting multiple files
- flagging duplicate buildings, selecting which building to use (in some cases a dataset will have different building boundaries)
- adding building heights from heuristics and multiple datasets
- reimporting CBL lists

## Releasing

- These instructions are not yet complete
- Release CBL workflow
- Update this repo's `pyproject.toml` to point to the cbl-workflow version on PyPi
- Update CHANGELOG by running auto generation on GitHub.
- Tag on GitHub

## Disclaimer

When using this tool with the MapQuest geocoding API (or any other geocoder) always confirm that the terms of service allow for using and storing geocoding results (as with the MapQuest Enterprise license)
