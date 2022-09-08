export function mockFn(name) {
    console.log('auto-test-mock-fn:' + name)
    return () => jest.fn()
}
