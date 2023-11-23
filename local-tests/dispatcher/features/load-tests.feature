
Feature: Simulated load test

Background features are loaded for the test environment. 

Files crucial for load testing are served for the automated testing process.

    serve files at /counter from "counter"

The test navigates to the authentication page and performs simulated login actions.

The load testing settings are configured to trigger tests from the a local folder.

    Dispatch load tests from "local-tests/client-test"
