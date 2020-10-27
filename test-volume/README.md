## Volume testing

This lambda can be used locally or deployed on a test environment to run volume test on the interoperability service.

It currently tests uploads.

## Set up

This setup assumes you already have a running setup for the interop service.


- Install the dependencies and create a basic environment configuration.
​
```bash
npm install
npm run create:env
```

- Add interop token and private key to `.env`. When adding the public key to the interop define a test region to make easier to exclude test data.

## Run

Run with

```
npm run test:volume
```

To provide custom parametes run with

```
npm run test:volume "{\"preBatches\": 1, \"preExposures\": 1, \"batches\": 1, \"exposures\": 1}"
```

## How it works

The test run in two different steps.

First it tries to preload the database with some exposure data. It does so by calling the `upload` endpoint `preBatches` times, each time with `preExposure` fake exposures.

Then it run the `upload` endpoint `batches` times with `exposures` fake exposures each time.

The lambda will report the execution time of every single batch and the total and average execution time for the two different steps.

Reported times are in milliseconds and include network time.

After the execution the lambda will try to remove the uploaded expsures from the database.

## Configuration

### Params

|Name|Description|Default|
|----|-----------|-------|
|`preBatches`|Number of batches to upload during preload|0|
|`preExposure`|Number of exposures per batch to upload during preload|5000|
|`Batches`|Number of batches to upload during test|1|
|`Exposure`|Number of exposures per batch to upload during test|1|

### Env

|Name|Description|
|----|-----------|
|`INTEROP_URL`|Url for the interop service|
|`INTEROP_SERVER_ID`|Id of the interop server. Only used for display|
|`UPLOAD_INTEROP_TOKEN`|Interop service token|
|`UPLOAD_INTEROP_PRIVATE_KEY`|Private key for the interop client|