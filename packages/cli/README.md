# @kollaudo/cli

Send test results to [Kollaudo](https://github.com/kollaudo/kollaudo) and gate promotions on its
verdict, from any CI or script. Requires Node.js 24.

```bash
export KOLLAUDO_URL=https://kollaudo.example.com
export KOLLAUDO_TOKEN=<an ingest token of your project>

# send a CTRF report of tests run against staging
npx @kollaudo/cli push ctrf-report.json --component frontend --env staging --version 1.2.0

# can 1.2.0 leave staging? exit code 0 = pass, 1 = fail, 2 = unknown, 3 = no verdict
npx @kollaudo/cli verdict --component frontend --env staging --version 1.2.0 --require e2e
```

`kollaudo --help` and `kollaudo <command> --help` document every option. See
[sending test results](https://github.com/kollaudo/kollaudo/blob/main/docs/sending-results.md) for
reporters, CI examples and how to use the verdict as a gate.

## License

[Apache-2.0](https://github.com/kollaudo/kollaudo/blob/main/LICENSE)
