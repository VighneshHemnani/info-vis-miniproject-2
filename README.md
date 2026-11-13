# U.S. Integrated-Circuit Imports

An interactive dashboard for exploring U.S. integrated-circuit imports from 2019 to 2025 by product and country of origin.

[Open the live dashboard](https://vighneshhemnani.github.io/info-vis-miniproject-2/)

## Data

The dashboard uses a [processed CSV](data/process-data.csv) built from the [U.S. Census Bureau’s Merchandise Trade Imports data](https://www.census.gov/foreign-trade/data/IMDB.html) for HTS 8542. See [prepare-data.ipynb](prepare-data.ipynb) for the processing steps.

## Run locally

Run this command from the repository root.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.
