const cwdPath = process.cwd()
const path = require('path')
const fs = require('fs-extra')
const _ = require('lodash')

function getTestFileDir(file) {
    const relativeResFile = _.replace(file, cwdPath + '/src', '')
    const absoluteResFile = path.resolve('./test' + relativeResFile.replace('.', '_'))
    return absoluteResFile
}

function resolveTestFile(file, resPath) {
    return path.resolve(getTestFileDir(file), resPath)
}

function makeTestDir(file) {
    fs.ensureDirSync(getTestFileDir(file))
}

async function mapSchema(file, cb) {
    const mockSchema = await fs.readJSON(resolveTestFile(file, './schema.json'))
    const res = _.map(mockSchema.properties, (v, key) => {
        return cb(v, key, mockSchema)
    })
    return Promise.all(res)
}

async function batchRun(list, cb) {
    const batch = _.chunk(list, 2)

    const res = []

    for (let i = 0; i < batch.length; i++) {
        console.log(`第${i}批`, batch[i])
        _.concat(res, await Promise.all(batch[i].map(cb)))
    }
    return res
}

const logPrefix = 'auto-test-'

function getLogName(key) {
    return `${logPrefix}${key}:`
}

function isCaseLog(str) {
    return _.startsWith(_.trim(str), logPrefix)
}

function getCaseLogValue(str) {
    const row = _.split(_.replace(str, logPrefix, '').trim(), ':')
    const key = _.trim(row[0])
    const value = _.trim(_.join(_.slice(row, 1), ':'))
    return [key, value]
}

function parseLog(logStr) {
    const list = _.split(logStr, '\n')
    const resLog = _.filter(list, isCaseLog)

    const res = {}
    let currentIndex = 0
    _.forEach(resLog, item => {
        const [key, value] = getCaseLogValue(item)
        switch (key) {
            case 'index':
                currentIndex = +value
                res[currentIndex] = {}
                break;
            case 'mock-fn':
                if (res[currentIndex]['mock-fn']) {
                    if (res[currentIndex]['mock-fn'][value]) {
                        res[currentIndex]['mock-fn'][value] += 1
                    } else {
                        res[currentIndex]['mock-fn'][value] = 1
                    }
                } else {
                    res[currentIndex]['mock-fn'] = { [value]: 1 }
                }
            default:
                res[currentIndex][key] = value
                break;

        }

    })
    return res
}

module.exports = {
    getTestFileDir,
    resolveTestFile,
    makeTestDir,
    mapSchema,
    batchRun,
    getLogName,
    parseLog,
}