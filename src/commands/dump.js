const { dim, green, red } = require('chalk')
const loadConfig = require('./../utils/loadConfig')
const COS = require('ibm-cos-sdk')
const optionsParse = require('./../utils/optionsParse')
const cosEndpointBuilder = require('./../utils/cosEndpointBuilder')
const Spinner = require('./../utils/spinner')
const picker = require('./../utils/picker')
const fs = require('fs-extra')

// TODO: Account for buckets with more than 1000 files.
const downloadBucket = async (cos, bucket, path) => {
  const files = await cos
    .listObjectsV2({ Bucket: bucket })
    .promise()
    .then(data =>
      data.Contents.map(o => o.Key).filter(name => !name.endsWith('/'))
    )

  const promises = files.map(file => {
    const outputPath = `./${path}/${bucket}/${file}`
    return cos
      .getObject({
        Bucket: bucket,
        Key: file
      })
      .promise()
      .then(data => fs.outputFile(outputPath, data.Body))
  })
  await Promise.all(promises)
}

async function listBuckets({ region, access_key_id, secret_access_key }) {
  const config = {
    endpoint: cosEndpointBuilder(region, true),
    accessKeyId: access_key_id,
    secretAccessKey: secret_access_key
  }
  const cos = new COS.S3(config)
  return await cos
    .listBuckets()
    .promise()
    .then(data =>
      data.Buckets.map(bucket => {
        return bucket.Name
      })
    )
}

async function checkRegion(
  { region, access_key_id, secret_access_key },
  bucket
) {
  const config = {
    endpoint: cosEndpointBuilder(region, true),
    accessKeyId: access_key_id,
    secretAccessKey: secret_access_key
  }
  const cos = new COS.S3(config)
  try {
    const region = await cos
      .getBucketLocation({ Bucket: bucket })
      .promise()
      .then(data => data.LocationConstraint)
    if (region) {
      return true
    }
    return false
  } catch {
    return false
  }
}

module.exports = async options => {
  // Parse help options.
  const parser = optionsParse()
  parser.add(['--config', '-c'])
  parser.add([true, 'help', '--help', '-help', '-h'])
  const ops = parser.parse(options)

  // If help was an option, print usage and exit.
  if (ops.help) {
    console.log('cacli export')
    return process.exit()
  }

  const config = loadConfig(ops.config)

  const spinner = new Spinner()
  spinner.setMessage('Authenticating...')
  spinner.start()

  let buckets
  try {
    buckets = await listBuckets(config.credentials.cos)
    spinner.stop()
  } catch (e) {
    spinner.stop()
    switch (e.code) {
      case 'InvalidAccessKeyId':
        // InvalidAccessKeyId - The AWS Access Key ID you provided does not exist in our records.
        console.error(
          `${red(
            'error'
          )} The provided Cloud Object Storage \`access_key_id\` is invalid.`
        )
        return process.exit(1)
      case 'CredentialsError':
        // CredentialsError - Missing credentials in config
        console.error(
          `${red('error')} No Cloud Object Storage credentials were provided.`
        )
        return process.exit(1)
      case 'SignatureDoesNotMatch':
        // SignatureDoesNotMatch - The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method. For more information, see REST Authentication and SOAP Authentication for details.
        console.error(
          `${red(
            'error'
          )} The provided Cloud Object Storage \`secret_access_key\` is invalid.`
        )
        return process.exit(1)
      case 'UnknownEndpoint':
        // UnknownEndpoint - Inaccessible host: `s3-api.XXX.objectstorage.softlayer.net'. This service may not be available in the `us-east-1' region.
        console.error(
          `${red(
            'error'
          )} The provided Cloud Object Storage \`region\` is invalid.`
        )
        return process.exit(1)
      default:
        console.error(`${red('error')} ${e.code} - ${e.message}`)
        return process.exit(1)
    }
  }

  if (buckets) {
    const bucket = await picker(
      `Choose a bucket to export: ${dim('(Use arrow keys)')}`,
      buckets
    )

    spinner.setMessage(`Checking bucket...`)

    if (!(await checkRegion(config.credentials.cos, bucket))) {
      spinner.stop()
      console.error(
        `${red('error')} The selected bucket is not in the region \`${
          config.credentials.cos.region
        }\`.`
      )
      return process.exit(1)
    }

    spinner.stop()

    spinner.setMessage(`Exporting ${bucket}...`)
    spinner.start()
    const { region, access_key_id, secret_access_key } = config.credentials.cos
    const cosConfig = {
      endpoint: cosEndpointBuilder(region, true),
      accessKeyId: access_key_id,
      secretAccessKey: secret_access_key
    }
    const cos = new COS.S3(cosConfig)
    await downloadBucket(cos, bucket, 'exported_buckets')
    spinner.stop()
    console.log(`${green('success')} Export complete.`)
  }
}
