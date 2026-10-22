if ($env:GITHUB_ACTIONS -ne 'true' -or $env:ACROCLIP_ISOLATED_TEST_RUNNER -ne 'github-hosted' -or -not $env:ACROCLIP_TEST_RENDER_ENDPOINT_ID) {
    throw 'Interactive tests did not run. Use a disposable CI desktop with a verified private audio endpoint. No local files were uploaded and no installer or test window was started.'
}
