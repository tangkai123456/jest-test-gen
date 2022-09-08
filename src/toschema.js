const { Project, SyntaxKind } = require('ts-morph')
const { programFromConfig, generateSchema } = require('typescript-json-schema')

const jsf = require('json-schema-faker')
const fs = require('fs-extra')
const _ = require('lodash')
const cb = require('js-combinatorics')
const { exec, spawn } = require('child_process')
const glob = require('glob')
const { resolveTestFile, makeTestDir, mapSchema, batchRun, getLogName, parseLog } = require('./utils')

const cwdPath = process.cwd()

const defaultGenConfig = {
    project: '',
    maxIndex: 5,
    maxOptionsLength: 5,
    ignoreList: [],
    unvalidModule: []
}


const genConfig = _.assign(defaultGenConfig, require(`${cwdPath}/genConfig.json`))

function init() {
    const unvalidModule = genConfig.unvalidModule
    unvalidModule.forEach(item => {
        const pkgPath = `${cwdPath}/node_modules/${item}/package.json`
        const pkg = fs.readJsonSync(pkgPath)
        if (pkg && pkg.main && pkg.main.startsWith('/')) {
            pkg.main = `.${pkg.main}`
        }
        fs.writeJsonSync(pkgPath, pkg)
    })
}

function gen() {
    init()
    const project = new Project({
        tsConfigFilePath: `${cwdPath}/tsconfig.json`,
        skipAddingFilesFromTsConfig: true,
    });
    project.addSourceFilesAtPaths(genConfig.project);

    project.getSourceFiles().forEach(async (file) => {

        const filePath = file.getFilePath()
        const copyFile = file.copy('_copy_' + file.getBaseName(), { overwrite: true })
        makeTestDir(filePath)

        try {
            await makeType(copyFile)
            await makeSchema(filePath, copyFile.getFilePath())
            await makeMockByOptions(filePath)
            await generateMock(filePath)
            await genCase(filePath)
            await genExpect(filePath)
            await genCaseWithExpect(filePath)
            await run(filePath)

            copyFile.deleteImmediately()
        } catch (error) {
            copyFile.deleteImmediately()
            throw new Error(error)
        }
    })
}

async function makeType(file) {
    console.log('开始 makeType', file.getFilePath())

    const fnList = []

    file.getVariableStatements().forEach(item => {
        if (item.hasExportKeyword()) {
            item.getDeclarations().forEach(item => {
                fnList.push(item.getName())
            })
        }
    })
    file.getFunctions().forEach(item => {
        if (item.hasExportKeyword()) {
            fnList.push(item.getName())
        }
    })
    file.getExportAssignments().forEach(item => {
        if (item.isKind(SyntaxKind.Identifier)) {
            fnList.push(item.getExpression().getText())
        }
    })

    const p = file.getTypeAlias('_TParams')
    const p2 = file.getTypeAlias('Params')

    p && p.remove()
    p2 && p2.remove()

    file.addTypeAlias({
        name: 'Params', type: (write) => {
            write.write('T extends (...args: any) => any ? Parameters<T> : never')
        }, typeParameters: 'T'
    })

    _.pull(fnList, ...genConfig.ignoreList)

    file.addTypeAlias({
        name: '_TParams',
        type: (write) => {
            write.writeLine('{')
            fnList.forEach(fn => {
                write.writeLine(`${fn}: Params<typeof ${fn}>`)
            })
            write.writeLine('}')
        }
    })

    await file.save()
}


function makeSchema(filePath, copyFilePath) {
    console.log('开始 makeSchema' + filePath)

    const typings = glob.sync(`${cwdPath}/src/**/*.d.ts`)
    const program = programFromConfig(`${cwdPath}/tsconfig.json`, typings.concat(copyFilePath))
    const schema = generateSchema(program, "_TParams", { required: true, ignoreErrors: true })

    fs.writeFileSync(resolveTestFile(filePath, './schema.json'), JSON.stringify(schema, null, 2), () => { })
}


function makeMockByOptions(file) {
    console.log('开始 makeMockByOptions')
    fs.ensureDirSync(resolveTestFile(file, './schema_case'))


    return mapSchema(file, (v, key, schema) => {
        const make = (schemaItem, index = 0) => {
            const makeWithIndex = (item) => {
                return make(item, index + 1)
            }
            if (!schemaItem) {
                return []
            }

            if (genConfig.maxIndex && index > genConfig.maxIndex) {
                return [schemaItem]
            }
            const schemaList = []
            if (_.isEmpty(schemaItem)) {
                schemaItem.example = 'empty str'
                return [schemaItem]
            }

            if (schemaItem.$ref) {
                const refName = _.last(schemaItem.$ref.split('/'))
                const refObj = schema.definitions[refName]
                return makeWithIndex(refObj)
            }

            if (schemaItem.anyOf) {
                _.forEach(schemaItem.anyOf, item => {
                    makeWithIndex(item).forEach(_item => {
                        schemaList.push(_item)
                    })
                })
                return schemaList
            }


            if (schemaItem.type === 'boolean') {
                schemaList.push({
                    ...schemaItem,
                    type: 'boolean',
                    default: true
                })
                schemaList.push({
                    ...schemaItem,
                    type: 'boolean',
                    default: false
                })
                return schemaList
            }
            if (['string', 'number'].includes(schemaItem.type) && schemaItem.enum) {
                _.forEach(schemaItem.enum, item => {
                    const copySchema = _.cloneDeep(schemaItem)
                    copySchema.default = item
                    schemaList.push(copySchema)
                })

                return schemaList
            }

            if (schemaItem.allOf) {
                const allObject = _.every(schemaItem.allOf, (item => item.type === 'object'))
                if (allObject) {
                    schemaItem.type = 'object'
                    schemaItem.properties = _.assign({}, ..._.map(schemaItem.allOf, 'properties'))
                    schemaItem.required = _.uniq(_.flatten(_.map(schemaItem.allOf, 'required')))
                    delete schemaItem.allOf
                }
            }

            if (schemaItem.type === 'array') {
                if (_.isArray(schemaItem.items)) {
                    const res = _.map(schemaItem.items, item => makeWithIndex(item))
                    res.forEach((item, index) => {
                        item.forEach(_item => {
                            if (_item.properties || 'default' in _item) {
                                const copySchema = _.cloneDeep(schemaItem)
                                copySchema.items[index] = _item
                                schemaList.push(copySchema)
                            }
                        })
                    })
                    return schemaList.length ? schemaList : [schemaItem]
                }
                const res = makeWithIndex(schemaItem.items)
                schemaItem.items = res
                return [schemaItem]

            }

            if (schemaItem.type === 'object') {
                const allKey = _.keys(schemaItem.properties)
                const optionalKeys = _.difference(allKey, schemaItem.required)
                if (optionalKeys.length > genConfig.maxOptionsLength) {
                    return [schemaItem]
                }

                for (let i = 0; i <= optionalKeys.length; i++) {
                    const combination = new cb.Combination(optionalKeys, i)
                    for (const elem of combination) {

                        const removeKeys = _.difference(optionalKeys, elem)
                        const copySchema = _.cloneDeep(schemaItem)
                        removeKeys.forEach(key => {
                            delete copySchema.properties[key]
                        })
                        copySchema.required = [...(copySchema.required || []), ...elem]


                        const res = makeWithIndex(copySchema.properties)
                        res.forEach(item => {
                            const _copySchema = _.cloneDeep(copySchema)
                            _copySchema.properties = item
                            schemaList.push(_copySchema)
                        })
                    }
                }

                return schemaList
            } else if (!schemaItem.type) {
                const res = _.map(schemaItem, (v, key) => {
                    const va = makeWithIndex(v)
                    return { key, value: va }
                })

                const hasChild = _.find(schemaItem, v => v.properties)

                res.forEach((item) => {
                    item.value.forEach(_item => {
                        if (hasChild && !_item.properties) {
                            return
                        }
                        const copySchema = _.cloneDeep(schemaItem)
                        copySchema[item.key] = _item
                        schemaList.push(copySchema)
                    })

                })

                const list = _.uniqWith(schemaList, _.isEqual)
                return list.length ? list : [schemaItem]
            }

            return [schemaItem]
        }
        const res = make(v);
        const schemaCase = {
            "type": "array",
            items: res,
            definitions: schema.definitions
        }
        return fs.writeFile(resolveTestFile(file, `./schema_case/${key}.json`), JSON.stringify(schemaCase, null, 2))
    })

}

function generateMock(file) {
    console.log('开始 generateMock')
    fs.ensureDirSync(resolveTestFile(file, './mock_data'))
    return mapSchema(file, async (v, key) => {
        console.log('genmock-key', key)
        const schema = await fs.readJSON(resolveTestFile(file, `./schema_case/${key}.json`))
        jsf.option({ useDefaultValue: true, useExamplesValue: true })
        const mock = jsf.generate({ list: schema.items, definitions: schema.definitions })
        return fs.writeFile(resolveTestFile(file, `./mock_data/${key}.json`), JSON.stringify(mock, null, 2))
    })

}

function genCase(file) {
    console.log('开始 genCase')
    fs.ensureDirSync(resolveTestFile(file, './init_case'))
    return mapSchema(file, async (v, key) => {
        const mock = await fs.readJSON(resolveTestFile(file, `./mock_data/${key}.json`))
        const str = `
        import {${key}} from '${_.replace(file, cwdPath + '/', '')}'
        describe('${key}', () => {
            ${_.map(mock.list, (item, index) => `
                it('测试${index}', () => {
                    const data = ${JSON.stringify(item)};
                    console.log('${getLogName('index')}', ${index})
                    const res = ${key}(...data)
                    // expect
                    console.log('${getLogName('res')}', JSON.stringify(res));
                });
            `).join('')}
        });
        `

        return fs.writeFile(resolveTestFile(file, `./init_case/${key}.test.js`), str)
    })
}

async function genExpect(file) {
    console.log('开始 genExpect')
    fs.ensureDirSync(resolveTestFile(file, './expect_data/'))

    const runList = []

    await mapSchema(file, (v, key) => {
        runList.push({ key, run: [`--config=${cwdPath}/jest.config.js`, "--json", `--testPathPattern=${resolveTestFile(file, `./init_case/${key}.test.js`)}`] })
    })

    return batchRun(runList, item => {
        return new Promise((resolve, reject) => {

            const res = spawn('jest', item.run)
            let stderr = ''
            let stdout = ''
            res.stderr.on('data', (data) => {
                stderr += data
            })

            res.stderr.on('end', async (data = '') => {
                stderr += data

                if (stderr.startsWith('FAIL')) {
                    reject(stderr)
                } else {
                    const expectList = parseLog(stderr)

                    console.log('stderr----', expectList)
                    await fs.writeFile(resolveTestFile(file, `./expect_data/${item.key}.json`), JSON.stringify(expectList, null, 2))
                    resolve()
                }
            })
        })
    })
}


function genCaseWithExpect(file) {
    console.log('开始 genCaseWithExpect')
    fs.ensureDirSync(resolveTestFile(file, './case_with_expect'))
    return mapSchema(file, async (v, key) => {
        const mock = await fs.readJSON(resolveTestFile(file, `./mock_data/${key}.json`))
        const expectList = await fs.readJSON(resolveTestFile(file, `./expect_data/${key}.json`))
        const str = `
        import {${key}} from '${_.replace(file, cwdPath + '/', '')}'
        describe('${key}', () => {
            ${_.map(mock.list, (item, index) => `
                it('测试${index}', () => {
                    const data = ${JSON.stringify(item)};
            
                    const res = ${key}(...data)
                    expect(res).toEqual(${expectList[index].res})
                });
            `).join('')}
        });
        `

        return fs.writeFile(resolveTestFile(file, `./case_with_expect/${key}.test.js`), str)
    })
}

function run(file) {
    console.log('开始 run')
    return mapSchema(file, (v, key) => {
        exec(`jest --config=${cwdPath}/jest.config.js --json --testPathPattern=${resolveTestFile(file, `./case_with_expect/${key}.test.js`)}`, (e, out, err) => {
            console.log(err)
        })
    })
}

// gen()


exports.gen = gen