const pg = require('pg')
const sql = require('@nearform/sql')
const AWS = require('aws-sdk')

const isProduction = /^\s*production\s*$/i.test(process.env.NODE_ENV)
const ssm = new AWS.SSM({ region: process.env.AWS_REGION })
const secretsManager = new AWS.SecretsManager({
  region: process.env.AWS_REGION
})

async function getParameter(id) {
  const response = await ssm
    .getParameter({ Name: `${process.env.CONFIG_VAR_PREFIX}${id}` })
    .promise()

  return response.Parameter.Value
}

async function getSecret(id) {
  const response = await secretsManager
    .getSecretValue({ SecretId: `${process.env.CONFIG_VAR_PREFIX}${id}` })
    .promise()

  return JSON.parse(response.SecretString)
}

async function getInteropConfig() {
  if (!isProduction) {
    return {
      id: process.env.INTEROP_SERVER_ID,
      upload: {
        privateKey: process.env.UPLOAD_INTEROP_PRIVATE_KEY,
        token: process.env.UPLOAD_INTEROP_TOKEN
      },
      url: process.env.INTEROP_URL
    }
  }

  return getSecret('volume-test-config')
}

async function getDatabase() {
  let client

  if (isProduction) {
    const [
      { username: user, password },
      host,
      port,
      ssl,
      database
    ] = await Promise.all([
      getSecret('rds-read-write'),
      getParameter('db_host'),
      getParameter('db_port'),
      getParameter('db_ssl'),
      getParameter('db_database')
    ])

    client = new pg.Client({
      host,
      database,
      user,
      password,
      port: Number(port),
      ssl:
        ssl === 'true'
          ? {
              rejectUnauthorized: false
            }
          : false
    })
  } else {
    const opts = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      ssl: /true/i.test(process.env.DB_SSL),
      database: process.env.DB_DATABASE
    }

    client = new pg.Client(opts)
  }

  await client.connect()
  return client
}

async function cleanup(batchTags) {
  if (!batchTags.length) {
    return
  }

  const client = await getDatabase()

  await client.query(sql`
    DELETE FROM exposures
    WHERE upload_batch_id IN (
      SELECT id
      FROM upload_batches
      WHERE tag = ANY(${batchTags})
    )
  `)
  await client.query(sql`
    DELETE FROM upload_batches
    WHERE tag = ANY(${batchTags})
  `)
}

function runIfDev(fn) {
  if (!isProduction) {
    fn(JSON.parse(process.argv[2] || '{}'))
      .then(result => {
        console.log(result)
        process.exit(0)
      })
      .catch(error => {
        console.log(error)
        process.exit(1)
      })
  }
}

module.exports = {
  getInteropConfig,
  cleanup,
  runIfDev
}
