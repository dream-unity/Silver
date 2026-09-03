import { copyFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'

const outputDirectory = new URL('../dist/', import.meta.url)
const outputAssets = new URL('assets/', outputDirectory)
const publishedAssets = new URL('../assets/', import.meta.url)
const manifestName = 'asset-manifest.json'
const manifestUrl = new URL(manifestName, publishedAssets)
const maxGenerations = 6

await rename(new URL('app.html', outputDirectory), new URL('index.html', outputDirectory))

const builtAssetNames = (await readdir(outputAssets)).filter((name) => !name.endsWith('.map'))
for (const name of await readdir(outputAssets)) {
  if (name.endsWith('.map')) await rm(new URL(name, outputAssets))
}

let previousGenerations = []
try {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  if (manifest?.version === 1 && Array.isArray(manifest.generations)) {
    previousGenerations = manifest.generations.filter((generation) =>
      Array.isArray(generation) && generation.every((name) => typeof name === 'string'),
    )
  }
} catch {
  try {
    const existing = (await readdir(publishedAssets)).filter((name) => name !== manifestName && !name.endsWith('.map'))
    if (existing.length) previousGenerations = [existing]
  } catch {
    previousGenerations = []
  }
}

const generationKey = (generation) => [...generation].sort().join('\u0000')
const currentKey = generationKey(builtAssetNames)
const generations = [
  builtAssetNames,
  ...previousGenerations.filter((generation) => generationKey(generation) !== currentKey),
].slice(0, maxGenerations)

for (const name of new Set(generations.slice(1).flat())) {
  try {
    await copyFile(new URL(name, publishedAssets), new URL(name, outputAssets))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

await writeFile(new URL(manifestName, outputAssets), `${JSON.stringify({ version: 1, generations }, null, 2)}\n`)
