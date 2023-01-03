import * as path from 'path'
import * as os from 'os'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import {type NonEmptyString} from '../core/types'

/**
 * Installs `coursier` and add its executable to the `PATH`.
 *
 * Once coursier is installed, installs the JVM and the `scalafmt`
 * and `scalafix` tools.
 *
 * Throws error if the installation fails.
 */
export async function install(): Promise<void> {
  try {
    const coursierUrl = core.getInput('coursier-cli-url')

    core.debug(`Installing coursier from ${coursierUrl}`)

    const binPath = path.join(os.homedir(), 'bin')
    await io.mkdirP(binPath)

    const zip = await tc.downloadTool(coursierUrl, path.join(binPath, 'cs.gz'))

    await exec.exec('gzip', ['-d', zip], {silent: true})
    await exec.exec('chmod', ['+x', path.join(binPath, 'cs')], {silent: true})

    core.addPath(binPath)

    await exec.exec(
      'cs',
      ['setup', '--yes', '--jvm', 'adoptium:17', '--apps', 'scalafmt,scalafix', '--install-dir', binPath],
      {
        silent: true,
        listeners: {stdline: core.debug, errline: core.debug},
      },
    )

    const coursierVersion = await execute('cs', 'version')

    core.info(`✓ Coursier installed, version: ${coursierVersion.trim()}`)

    const scalafmtVersion = await execute('scalafmt', '--version')

    core.info(`✓ Scalafmt installed, version: ${scalafmtVersion.replace(/^scalafmt /, '').trim()}`)

    const scalafixVersion = await execute('scalafix', '--version')

    core.info(`✓ Scalafix installed, version: ${scalafixVersion.trim()}`)
  } catch (error: unknown) {
    core.debug((error as Error).message)
    throw new Error('Unable to install coursier or managed tools')
  }
}

/**
 * Launches an app using `coursier`.
 *
 * Refer to [coursier](https://get-coursier.io/docs/cli-launch) for more information.
 *
 * @param app - The application's artifact name.
 * @param version - The application's version.
 * @param args - The args to pass to the application launcher.
 */
export async function launch(
  app: string,
  version: NonEmptyString | undefined,
  args: Array<string | string[]> = [],
): Promise<void> {
  const name = version ? `${app}:${version.value}` : app

  core.startGroup(`Launching ${name}`)

  const launchArgs = [
    'launch',
    '--contrib',
    '-r',
    'sonatype:snapshots',
    name,
    '--',
    ...args.flatMap((arg: string | string[]) => (typeof arg === 'string' ? [arg] : arg)),
  ]

  const code = await exec.exec('cs', launchArgs, {
    silent: true,
    ignoreReturnCode: true,
    listeners: {stdline: core.info, errline: core.error},
  })

  core.endGroup()

  if (code !== 0) {
    throw new Error(`Launching ${name} failed`)
  }
}

/**
 * Tries to restore the Coursier cache, if there is one.
 */
export async function restoreCache(hash: string): Promise<void> {
  try {
    core.startGroup('Trying to restore Coursier\'s cache...')

    const cacheHit = await cache.restoreCache(
      [path.join(os.homedir(), '.cache', 'coursier', 'v1')],
      `coursier-cache-${hash}-${Date.now().toString()}`,
      [`coursier-cache-${hash}`, 'coursier-cache-'],
    )

    if (cacheHit) {
      core.info('Coursier cache was restored')
    } else {
      core.info('Coursier cache wasn\'t found')
    }

    core.endGroup()
  } catch (error: unknown) {
    core.debug((error as Error).message)
    core.warning('Unable to restore Coursier\'s cache')
    core.endGroup()
  }
}

/**
 * Tries to save the Coursier cache.
 */
export async function saveCache(hash: string): Promise<void> {
  try {
    core.startGroup('Saving Coursier\'s cache...')

    await cache.saveCache(
      [path.join(os.homedir(), '.cache', 'coursier', 'v1')],
      `coursier-cache-${hash}-${Date.now().toString()}`,
    )

    core.info('Coursier cache has been saved')
    core.endGroup()
  } catch (error: unknown) {
    core.debug((error as Error).message)
    core.warning('Unable to save Coursier\'s cache')
    core.endGroup()
  }
}

/**
 * Removes coursier binary
 */
export async function remove(): Promise<void> {
  await io.rmRF(path.join(os.homedir(), '.cache', 'coursier', 'v1'))
  await exec.exec('cs', ['uninstall', '--all'], {
    silent: true,
    ignoreReturnCode: true,
    listeners: {stdline: core.debug, errline: core.debug},
  })
  await io.rmRF(path.join(os.homedir(), 'bin', 'cs'))
  await io.rmRF(path.join(os.homedir(), 'bin', 'scalafmt'))
  await io.rmRF(path.join(os.homedir(), 'bin', 'scalafix'))
}

/**
 * Executes a tool and returns its output.
 */
async function execute(tool: string, ...args: string[]): Promise<string> {
  let output = ''

  const code = await exec.exec(tool, args, {
    silent: true,
    ignoreReturnCode: true,
    listeners: {stdout(data) {
      (output += data.toString())
    }, errline: core.debug},
  })

  if (code !== 0) {
    throw new Error(`There was an error while executing '${tool} ${args.join(' ')}'`)
  }

  return output
}
