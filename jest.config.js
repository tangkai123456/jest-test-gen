/** @format */

// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
    // A map from regular expressions to module names that allow to stub out resources with a single module
    moduleNameMapper: {
    },
    globals: {
        __CLIENT__: false,
        __SERVER__: true,
    },
    testEnvironment: 'jsdom',
};
