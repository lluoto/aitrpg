# Built-in TRPG Rules Licensing Audit

Date: 2026-08-09

This is a technical risk review, not a legal opinion. Final release decisions should be reviewed by counsel in the intended distribution jurisdictions.

## Executive conclusion

Free distribution does not automatically avoid copyright or trademark infringement. The repository currently contains a mixture of:

1. abstract game mechanics, which are generally lower copyright risk;
2. licensed/open rules content that requires attribution and scope compliance;
3. specific rule text, tables, product names, and non-SRD options that present materially higher risk.

The current repository should not be described as legally cleared for public distribution.

## Official sources

- Wizards, D&D System Reference Documents and CC-BY guidance: https://www.dndbeyond.com/srd
- Wizards Creator FAQ: https://www.dndbeyond.com/creator-faq
- Wizards Fan Content Policy: https://company.wizards.com/en/legal/fancontentpolicy
- Chaosium fan use and licensing: https://www.chaosium.com/fan-use-and-licensing/
- Chaosium fan-use/licensing Q&A: https://www.chaosium.com/fan-use-and-licensing-q-a/
- Chaosium BRP ORC license: https://www.chaosium.com/orc-license/
- Supreme People's Court discussion of game mechanics and expression: https://www.court.gov.cn/zixun/xiangqing/463511.html

## Legal distinction

Under the idea-expression distinction, abstract mechanics and methods are generally less likely to be protected by copyright than their concrete expression. Chinese judicial materials likewise distinguish game-play mechanisms from copyrightable text, art, software, and other concrete expression. This does not eliminate trademark, patent, contract, or unfair-competition risk, especially where a product copies a detailed system as a whole or creates source confusion.

## D&D findings

### Lower-risk/open path

Wizards publishes SRD 5.1 and SRD 5.2.1 under CC-BY-4.0. Content actually contained in the selected SRD can be used commercially or noncommercially if the required attribution and other CC-BY conditions are followed. Wizards expressly distinguishes the open SRD from D&D Beyond Basic Rules, which are not an open content-creation source.

### Repository findings

- `src/rules/dnd5e.yaml` identifies itself as an SRD rules subset and mostly stores compact mechanics/data.
- `src/rules/spells.yaml` mentions CC-BY-4.0 in a comment but the repository has no user-facing `LICENSE`, `NOTICE`, or attribution statement containing Wizards' required SRD attribution.
- `src/character/subclasses-extra.ts` explicitly contains PHB, Xanathar's, and Tasha's non-SRD subclasses.
- `src/index.ts` imports and registers `EXTRA_SUBCLASSES` by default, so those non-SRD options are not merely archival.

### Risk level

- SRD-only mechanics with correct attribution: manageable.
- SRD text translated/adapted without attribution/change notice: medium to high until corrected.
- Non-SRD subclasses, names, descriptions, or feature implementations: high; remove or obtain permission.
- D&D logos and marks: do not use without applicable permission. Prefer “5E compatible” wording permitted by the SRD guidance rather than implying official affiliation.

## Call of Cthulhu / Chaosium findings

### Official licensing position

Chaosium states that Call of Cthulhu is not released under its OGL/ORC licensing path. The BRP Universal Game Engine is available under ORC, but Chaosium reserves product identity including the Call of Cthulhu trademark. Chaosium's licensing Q&A also distinguishes public-domain Mythos material from Chaosium's protected roleplaying-game expression. It specifically states that monetized character-creation apps require a commercial license; software/app uses should not be assumed to fall within tabletop fan-material permissions.

### Repository findings

- `src/rules/coc-reference.ts` includes concrete weapon statistics, chase rules, and a detailed madness-results table.
- `src/api/game-session.ts` imports and exposes those references.
- `src/rules/coc-ruleset-mod.ts` uses product/variant identifiers including Pulp Cthulhu and implements detailed variant rules.
- Other code uses the Call of Cthulhu/CoC 7e name as a built-in product-facing ruleset label.
- Lovecraft-derived public-domain themes do not grant rights to Chaosium's rules text, tables, trade dress, logos, or trademarks.

### Risk level

- Original percentile mechanics and original cosmic-horror content under a neutral brand: lower risk.
- Exact or closely translated Chaosium tables/stat blocks/rules text: high.
- “Call of Cthulhu”, “CoC 7e”, and “Pulp Cthulhu” product-facing branding in a software app: trademark/licensing risk; do not assume free distribution cures it.

## Required release remediation

1. Restrict D&D-derived content to a specific SRD version and create a complete third-party attribution notice using the exact statement required by that SRD.
2. Remove PHB/Xanathar/Tasha non-SRD subclasses from default registration and distribution unless separately licensed.
3. Replace or remove concrete Chaosium-derived tables, stat blocks, madness results, and Pulp rules. Reimplement only abstract mechanics using original wording and original data design.
4. Rename the unlicensed product-facing ruleset to a neutral identifier such as “percentile cosmic horror”; avoid Chaosium logos, trade dress, and marks.
5. If retaining Call of Cthulhu compatibility or app features, obtain written licensing guidance from Chaosium.
6. Add `THIRD_PARTY_NOTICES.md` only after the retained content has been mapped line-by-line to an applicable license. Attribution does not legalize non-licensed content.
7. Obtain jurisdiction-specific legal review before public distribution, hosted access, or app-store submission.
