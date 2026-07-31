// @pal/contract — the wire contract between an integration and Pal's ingest API.
//
// Versions are namespaced so more than one can be supported at once during a
// rollout. Pal must accept a version before any producer emits it.
export * as v1 from "./v1/index";
