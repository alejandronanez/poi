/* eslint-disable unicorn/no-process-exit */
const util = require('util')
const fs = require('fs')
const url = require('url')
const chalk = require('chalk')
const notifier = require('node-notifier')
const co = require('co')
const stripAnsi = require('strip-ansi')
const tildify = require('tildify')
const merge = require('lodash/merge')
const opn = require('opn')
const loadPoiConfig = require('poi-load-config/poi')
const AppError = require('../lib/app-error')
const { cwd, ownDir, unspecifiedAddress } = require('../lib/utils')
const poi = require('../lib')
const logger = require('../lib/logger')

module.exports = co.wrap(function * (cliOptions) {
  const { inspectOptions } = cliOptions
  deleteExtraOptions(cliOptions, [
    '--',
    'v',
    'version',
    'h',
    'help',
    'inspectOptions',
    'inspect-options'
  ])

  console.log(`> Running in ${cliOptions.mode} mode`)

  let { path: configPath, config = {} } = yield loadPoiConfig({ config: cliOptions.config })

  if (configPath) {
    console.log(`> Using external Poi config file`)
    console.log(chalk.dim(`> location: "${tildify(configPath)}"`))
    config = handleConfig(config, cliOptions)
  } else if (cliOptions.config) {
    throw new AppError('Config file was not found!')
  }

  const app = poi(merge(config, cliOptions))

  yield app.prepare()

  console.log(`> Bundling with Webpack ${require('webpack/package.json').version}`)

  const { options } = app
  if (inspectOptions) {
    console.log('> Options:', util.inspect(options, { colors: true, depth: null }))
  }

  if (options.mode === 'production') {
    console.log('> Creating an optimized production build:\n')
    const stats = yield app.build()
    if (options.generateStats) {
      const statsFile = cwd(options.cwd, typeof options.generateStats === 'string' ? options.generateStats : 'stats.json')
      console.log('> Generating webpack stats file')
      fs.writeFileSync(statsFile, JSON.stringify(stats.toJson()), 'utf8')
      console.log(chalk.dim(`> location: "${tildify(statsFile)}"`))
    }
  } else if (options.mode === 'watch') {
    yield app.watch()
  } else if (options.mode === 'development') {
    const { server, host, port } = yield app.dev()

    server.listen(port, host)
    .on('error', err => {
      if (err.code === 'EADDRINUSE') {
        return handleError(new AppError(`Port ${port} is already in use.\n\nYou can use another one by adding \`--port <port>\` or set it in config file.`))
      }
      handleError(err)
    })

    app.once('compile-done', () => {
      if (options.open) {
        opn(url.format({
          protocol: 'http',
          hostname: unspecifiedAddress(host) ? 'localhost' : host,
          port
        }))
      }
    })
  } else if (options.mode === 'test') {
    app.test().catch(handleError)
  }
})

module.exports.handleError = handleError

function handleError(err) {
  console.log()
  if (err.name === 'AppError') {
    console.error(chalk.red(err.message))
  } else {
    console.error(err.stack.trim())
  }
  notifier.notify({
    title: 'Poi: error!',
    message: stripAnsi(err.stack).replace(/^\s+/gm, ''),
    icon: ownDir('bin/error.png')
  })
  console.log()
  logger.error('Failed to start!')
  console.log()
  process.exit(1)
}

function handleConfig(config, options) {
  if (typeof config === 'function') {
    config = config(options, require)
  }

  config = merge(config, config[options.mode])

  delete config.development
  delete config.production
  delete config.watch
  delete config.test

  return config
}

function deleteExtraOptions(obj, arr) {
  arr.forEach(k => delete obj[k])
}
