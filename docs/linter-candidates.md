# Linter-rule candidates (spec 050 D2a)

Mechanical, checkable rules surfaced by promotions/incidents, waiting to be folded into an
EXISTING linter (013/049 discipline — never a new script). One bullet per rule; dedup key is
the exact rule statement. When a rule ships, move its bullet to the shipping spec's log.

- environment_variables entries must use 'name:' (not 'variable:', the start-node input shape) — Dify import 400s 'missing name' — cite: `api/factories/variable_factory.py build_environment_variable_from_mapping`
