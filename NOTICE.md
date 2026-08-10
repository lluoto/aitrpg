# Third-Party Notices

This file records attribution required by licenses covering third-party material
retained in this repository. It is a compliance record, not legal advice.

---

## Dungeons & Dragons System Reference Document 5.1 (CC-BY-4.0)

This work includes material taken from the System Reference Document 5.1 ("SRD
5.1") by Wizards of the Coast LLC and available at
https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
licensed under the Creative Commons Attribution 4.0 International License
available at https://creativecommons.org/licenses/by/4.0/legalcode.

### Files covered

- `src/rules/dnd5e.yaml` — weapon, creature, and combat-resolution data
- `src/rules/spells.yaml` — spell data

### Changes made

CC-BY-4.0 requires indicating whether the licensed material was modified. It was:

- Content was translated from English into Simplified Chinese.
- Content was restructured into YAML records with keys and fields defined by this
  project, and abridged to the subset this project consumes.
- Descriptions were condensed; content not used by this project was omitted.

### Scope

This attribution covers only the two files listed above. No other file in this
repository is published or distributed as SRD material.

---

## Content NOT covered by any third-party license

The percentile investigation mechanics, sanity system, chase resolution, and
equipment data in `src/rules/` are original implementations written for this
project. They are not reproduced from, and are not licensed by, any commercial
rules publisher.

`Call of Cthulhu`, `Pulp Cthulhu`, and `Chaosium` are trademarks of Chaosium Inc.
This project holds no license from Chaosium and is not compatible with, derived
from, or endorsed by any Chaosium product.

The product-facing ruleset formerly keyed as `coc7e` has been renamed to the
neutral identifier `cosmic-horror`. Its display label is `宇宙恐怖（百分位）`,
and its CLI commands are `/horror-create` and `/horror-check`. Internal module
filenames and source comments still use a `coc`/`CoC 7e` shorthand as a
developer-facing abbreviation; these are not exposed in the UI or API.

Cthulhu Mythos themes derived from the works of H. P. Lovecraft are used as
public-domain source material. Public-domain status of the fiction does not
extend to any publisher's roleplaying-game rules text, tables, or trade dress.

---

## Removed content

The following third-party rules content was previously bundled and has been
deleted from this repository:

- Non-SRD character subclasses sourced from Player's Handbook, Xanathar's Guide
  to Everything, and Tasha's Cauldron of Everything.
- Verbatim quick-reference tables for weapons, chase resolution, and madness
  results.
- Pulp Cthulhu variant rules and its talent list.

Rules detail beyond the mechanics implemented here is expected to come from the
loaded module or from a rulebook supplied by the user.
