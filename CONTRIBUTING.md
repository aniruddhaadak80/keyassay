# Keyassay

## What this is

Keyassay performs a **real TLS handshake** with a public hostname, reads the certificate chain that
endpoint actually presents, pulls its Certificate Transparency history from crt.sh, and grades the key
material against a published estimate of what a cryptographically relevant quantum computer would
cost to break it. The result is persisted, signed with a SHA-384 hash chain, and downloadable as a
certificate.

It is an engineering measurement, not a scanner, a scanner comparison, or a compliance attestation.

## Local development

```bash
npm ci
npm run dev
```

Open http://localhost:3000. **No environment variables are required.** With no configuration the
repository adapter falls back to an embedded PGlite instance, which is real Postgres compiled to
WebAssembly, so the schema, constraints and transactions you exercise locally are the ones that run in
production.

## Quality commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, flat config, no suppressions
npm run test        # vitest: engine, integrity, X.509, persistence
npm run build       # production build
npm run smoke       # Playwright browser journey, desktop + mobile
```

`npm run smoke` and `npm run verify:live` need a server. Either run `npm run dev` or
`npm run build && npm start` in another terminal, then:

```bash
BASE_URL=http://localhost:3000 npm run verify:live
```

## What a good contribution looks like

- **Cite the source.** Any constant in `src/lib/engine/constants.ts` must name where it came from. A
  number without a citation does not go in.
- **Keep published constants separate from risk assumptions.** Constants (Shor circuit costs, NIST
  SP 800-57 equivalences, the IR 8547 dates) are not configurable, and making them so would let a
  reader tune the model until it produced the answer they wanted. Risk assumptions (the
  confidentiality horizon, the qubit growth rate) are the visitor's, and always labelled as such.
- **One engine.** If a score appears in a React component, a REST route and an MCP tool, all three
  call the same function in `src/lib/engine/assay.ts`. Re-implementing a calculation is the fastest
  way to make the certificate a lie.
- **Every mutation appends to the chain.** New write paths go through `src/lib/service.ts`. The seal
  is struck there, so a route that forgets to seal cannot exist.
- **Fallbacks are labelled.** If an upstream cannot be reached, the response says `fallback` and
  carries the reason. Never present a sealed sample as a live measurement.
- **Add a test.** The engine, the integrity chain and the repository each have a suite that runs
  without network access. Use a fixed clock and a fixed policy so results are deterministic.

## Reporting bugs

Open an issue with what you ran, what you expected, and what happened. For the engine, the
`engineVersion` string in the response and the policy in force are the two most useful details.

## Security issues

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).