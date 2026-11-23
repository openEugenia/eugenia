# openEugenia graphic charter (copy)

`openeugenia.css` is a copy of the compiled stylesheet of the graphic charter shared by the
openEugenia ecosystem: <https://github.com/hwattez/Graphic-charter> (documentation:
<https://openeugenia.github.io/Graphic-charter/>), MIT license.

- Version: 0.3.0 (commit `9caa394`), file `dist/openeugenia.css`.
- It provides the `--oe-*` tokens (light and dark colors, typography, spacing), the base styles
  and the `oe-*` components (buttons, cards, badges, alerts, fields…).

The charter is not published on npm yet: when it is, replace this copy with the
`@openeugenia/graphic-charter` dependency (`import "@openeugenia/graphic-charter/css"`). To
update the copy: `npm run build` in the charter's repository, then copy `dist/openeugenia.css`
here.
