# haibun-load-tests
run load tests using Haibun tests with scalable client containers

# Use with docker (containers

Please see [presentation](https://docs.google.com/presentation/d/1EE8VvFDLil6hy7EZeBH2hm18OWBdVEhFlwnc7_yMZUQ/edit?usp=sharing)

Create an env-client:
```
HAIBUN_O_WEBPLAYWRIGHT_STORAGE=StorageFS
HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=true
HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TOKEN=local92
HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TRACKS_STORAGE=StorageFS
HAIBUN_TRACE=true
HAIBUN_O_OUTREVIEWS_STORAGE=StorageFS
HAIBUN_O_HAIBUNLOADTESTSSTEPPER_DISPATCHER_ADDRESS=http://192.168.0.200:8123
```

Start the dispacher with eg `npm run local-500-dispatcher`

Start the clients with:

`docker compose  up --scale local-client=100`

Publish a report with `npm run publish`.
