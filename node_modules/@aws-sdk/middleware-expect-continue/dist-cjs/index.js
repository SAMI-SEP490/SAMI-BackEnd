'use strict';

var protocolHttp = require('@smithy/protocol-http');

function addExpectContinueMiddleware(options) {
    return (next) => async (args) => {
        const { request } = args;
        if (protocolHttp.HttpRequest.isInstance(request) && request.body && options.runtime === "node") {
            if (options.requestHandler?.constructor?.name !== "FetchHttpHandler") {
                request.headers = {
                    ...request.headers,
                    Expect: "100-continue",
                };
            }
        }
        return next({
            ...args,
            request,
        });
    };
}
const addExpectContinueMiddlewareOptions = {
    step: "build",
    tags: ["SET_EXPECT_HEADER", "EXPECT_HEADER"],
    name: "addExpectContinueMiddleware",
    override: true,
};
const getAddExpectContinuePlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(addExpectContinueMiddleware(options), addExpectContinueMiddlewareOptions);
    },
});

exports.addExpectContinueMiddleware = addExpectContinueMiddleware;
exports.addExpectContinueMiddlewareOptions = addExpectContinueMiddlewareOptions;
exports.getAddExpectContinuePlugin = getAddExpectContinuePlugin;
