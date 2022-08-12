const { Project, Node } = require('ts-morph')
const { getProgramFromFiles, generateSchema } = require('typescript-json-schema')
const path = require('path')
const jsf = require('json-schema-faker')
const fs = require('fs')
const _ = require('lodash')
const cb = require('js-combinatorics')

const file = './test.ts'
const fnList = []

function getFunction() {
    // initialize
    const project = new Project({
        // Optionally specify compiler options, tsconfig.json, in-memory file system, and more here.
        // If you initialize with a tsconfig.json, then it will automatically populate the project
        // with the associated source files.
        // Read more: https://ts-morph.com/setup/
    });
    project.addSourceFilesAtPaths("./*.ts");

    const testFile = project.getSourceFileOrThrow(path.resolve(file))

    testFile.getExportSymbols().forEach(item => {
        fnList.push(item)
    })

    // testFile.getVariableDeclarations().forEach(item => {
    //     if (Node.isArrowFunction(item.getInitializer())) {
    //         fnList.push(item)
    //     }
    // })

    // testFile.getFunctions().forEach(item => {
    //     fnList.push(item)
    // })

    const p = testFile.getTypeAlias('_TParams')
    const p2 = testFile.getTypeAlias('Params')

    p && p.remove()
    p2 && p2.remove()

    testFile.addTypeAlias({
        name: 'Params', type: (write) => {
            write.write('T extends (...args: any) => any ? Parameters<T> : never')
        }, typeParameters: 'T'
    })

    testFile.addTypeAlias({
        name: '_TParams',
        type: (write) => {
            write.writeLine('{')
            fnList.forEach(fn => {
                write.writeLine(`${fn.getName()}: Params<typeof ${fn.getName()}>`)

                // console.log(Params.getText())
                // Params.getTypeNode().addTypeAlias({
                //     name: typeName, type: (write) => {
                //         write.write(`Params<typeof ${fn.getName()}>`)
                //     }
                // })
                // Params.add({
                //     name: fn.getName(),
                // })
                // testFile.getTypeAlias(typeName) && testFile.getTypeAlias(typeName).remove()
                // testFile
            })
            write.writeLine('}')
        }
    })


    testFile.saveSync()
}

function makeSchema() {
    const program = getProgramFromFiles([path.resolve(file)])
    const schema = generateSchema(program, "_TParams", { required: true })

    console.log('schema-', schema)
    fs.writeFileSync('./schema.json', JSON.stringify(schema, null, 2), () => { })
}

function generateMock() {
    const schema = require('./testMock.json', 'utf-8')

    const totalMock = jsf.generate({ list: schema })

    fs.writeFile('./mock.json', JSON.stringify(totalMock, null, 2), () => {

    })
}

function makeMockByOptions() {
    const mockSchema = require('./schema.json', 'utf-8')

    // todo 枚举
    const make = (schemaItem) => {
        if (!schemaItem) {
            return []
        }
        const schemaList = []

        if (schemaItem.type === 'object') {
            const allKey = _.keys(schemaItem.properties)
            const optionalKeys = _.difference(allKey, schemaItem.required)

            for (let i = 0; i <= optionalKeys.length; i++) {
                const combination = new cb.Combination(optionalKeys, i)
                for (const elem of combination) {
                    const removeKeys = _.difference(optionalKeys, elem)
                    const copySchema = _.cloneDeep(schemaItem)
                    removeKeys.forEach(key => {
                        delete copySchema.properties[key]
                    })
                    copySchema.required = [...(copySchema.required || []), ...elem]


                    const res = make(copySchema.properties)
                    res.forEach(item => {
                        const _copySchema = _.cloneDeep(copySchema)
                        _copySchema.properties = item
                        schemaList.push(_copySchema)
                    })
                }
            }

            return schemaList
        } else if (schemaItem.items) {
            const res = _.map(schemaItem.items, item => make(item))
            res.forEach((item, index) => {
                item.forEach(_item => {
                    if (_item.properties) {
                        const copySchema = _.cloneDeep(schemaItem)
                        copySchema.items[index] = _item
                        schemaList.push(copySchema)
                    }
                })
            })
            return schemaList.length ? schemaList : [schemaItem]
        } else if (!schemaItem.type) {
            const res = _.map(schemaItem, (v, key) => {
                const va = make(v)
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

    fs.writeFileSync('./testMock.json', JSON.stringify(make(mockSchema), null, 2))
}

function genCase() {

}

getFunction()
makeSchema()
makeMockByOptions()
generateMock()
genCase()
