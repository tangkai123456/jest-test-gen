function mockFn(name) {
    return () => {
        console.log('auto-test-mock-fn:' + name)
        return jest.fn()
    }
}

exports.mockFn = mockFn