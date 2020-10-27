const crypto = require('crypto')
const { promisify } = require('util')
const fetch = require('node-fetch')
const { JWK, JWS } = require('node-jose')
const pTimes = require('p-times')
const uuid = require('uuid')

const { cleanup, getInteropConfig, runIfDev } = require('./utils')

const randomBytes = promisify(crypto.randomBytes)

const PRE_BATCHES = 0
const PRE_EXPOSURES = 5000
const BATCHES = 1
const EXPOSURES = 1

function generateRandomKeyData() {
  return randomBytes(16).then(buf => buf.toString('base64'))
}

async function generateRandomExposure() {
  return {
    keyData: await generateRandomKeyData(),
    rollingStartNumber: 2655169,
    transmissionRiskLevel: 0,
    rollingPeriod: 144,
    regions: ['test:volume']
  }
}

function generateRandomPayload(number) {
  return pTimes(number, generateRandomExposure, {
    concurrency: 50
  })
}

async function buildUploader(url, token, privateKey) {
  const key = await JWK.asKey(privateKey, 'pem')

  async function upload(batchTag, payload) {
    if (payload.length === 0) {
      return
    }

    const sign = JWS.createSign({ format: 'compact' }, key)
    const fetchOptions = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        batchTag,
        payload: await sign.update(JSON.stringify(payload), 'utf8').final()
      })
    }

    const start = Date.now()
    const result = await fetch(`${url}/upload`, fetchOptions)
    const end = Date.now()

    if (!result.ok) {
      const text = await result.text()
      throw new Error(`Upload failed with ${result.status} response: ${text}`)
    }

    return {
      duration: end - start
    }
  }

  return upload
}

async function batchedUpload(upload, nBatches, nExposures) {
  const batches = await pTimes(
    nBatches,
    generateRandomPayload.bind(null, nExposures),
    {
      concurrency: 10
    }
  )
  const res = []

  for (const batch of batches) {
    const batchTag = uuid.v4()
    const timings = await upload(batchTag, batch)
    if (timings) {
      res.push({
        tag: batchTag,
        timings
      })
    }
  }
  return res
}

function prepareResults(name, res) {
  const data = []
  let total = 0

  for (const run of res) {
    total += run.timings.duration
    data.push(run.timings.duration)
  }

  return {
    name,
    data,
    total,
    avg: total !== 0 ? total / data.length : 0
  }
}

function printResults(results) {
  if (process.env.PRINT_RESULTS !== 'true') {
    return
  }

  for (const res of results) {
    if (!res.data.length) {
      console.log(`\nNOT RUN: ${res.name}`)
      return
    }

    console.log(`RESULTS: ${res.name}`)
    console.log(`================`)

    for (const item of res.data) {
      console.log(item)
    }

    console.log(`----------------`)
    console.log('TOTAL:', res.total)
    console.log('AVG:', res.avg)

    console.log('\n')
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

exports.handler = async function({
  preBatches = PRE_BATCHES,
  preExposures = PRE_EXPOSURES,
  batches = BATCHES,
  exposures = EXPOSURES
} = {}) {
  const {
    id,
    upload: { privateKey, token },
    url
  } = await getInteropConfig()
  console.log(`start test "${id}" with options`, {
    preBatches,
    preExposures,
    batches,
    exposures
  })

  const tags = []

  try {
    const upload = await buildUploader(url, token, privateKey)

    const preRes = await batchedUpload(upload, preBatches, preExposures)
    tags.push(...preRes.map(res => res.tag))
    const res = await batchedUpload(upload, batches, exposures)
    tags.push(...res.map(res => res.tag))

    console.log('done testing')

    const results = [
      prepareResults('pre-populate', preRes),
      prepareResults('exec', res)
    ]

    printResults(results)

    return results
  } catch (err) {
    console.error(err)
    throw err
  } finally {
    try {
      console.log('start cleanup')
      await wait(500) // wait to avoid deadlocks with server
      await cleanup(tags)
      console.log('done cleanup')
    } catch (err) {
      console.error(err)
      throw err
    }
  }
}

runIfDev(exports.handler)
