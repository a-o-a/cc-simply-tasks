// Check that the configured quality gates reject real mistakes after upgrades.
// ESLint fixtures stay in memory; TypeScript fixtures use an isolated directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ESLint } = require("eslint");

const root = path.resolve(__dirname, "..");
const component = (jsx) => `export function View() { return ${jsx}; }`;
const rejected = [
  ["missing list key", "export function View(){return [1,2].map(x=><span>{x}</span>)}", "@eslint-react/no-missing-key"],
  ["anonymous component", "export default () => <span />", "import-x/no-anonymous-default-export"],
  ["anonymous memo wrapper", "import {memo} from 'react'; export default memo(() => <span />)", "import-x/no-anonymous-default-export"],
  ["JSX comment text", component("<span>// comment</span>"), "@eslint-react/jsx-no-comment-textnodes"],
  ["children prop", component('<span children="child" />'), "@eslint-react/jsx-no-children-prop"],
  ["HTML and JSX children", component("<div dangerouslySetInnerHTML={{__html:'x'}}>child</div>"), "@eslint-react/dom-no-dangerously-set-innerhtml-with-children"],
  ["JSX quotes", component(`<span>Bob's "tasks"</span>`), "no-restricted-syntax"],
  ["literal string ref", component('<input ref="legacy" />'), "no-restricted-syntax"],
  ["expression string ref", component("<input ref={'legacy'} />"), "no-restricted-syntax"],
  ["state increment", "import React from 'react'; class View extends React.Component {state={count:0};render(){this.state.count++;return null}}", "no-restricted-syntax"],
  ["isMounted call", "import React from 'react'; class View extends React.Component {isMounted(){return true}render(){this.isMounted();return null}}", "no-restricted-syntax"],
  ["HTML and createElement children", "import React from 'react'; React.createElement('div',{dangerouslySetInnerHTML:{__html:'x'}},'child')", "no-restricted-syntax"],
  ["HTML and props children", "import React from 'react'; React.createElement('div',{dangerouslySetInnerHTML:{__html:'x'},children:'child'})", "no-restricted-syntax"],
  ["quoted HTML and children keys", "import React from 'react'; React.createElement('div',{'dangerouslySetInnerHTML':{__html:'x'},['children']:'child'})", "no-restricted-syntax"],
  ["missing Image alt", "import Image from 'next/image'; export function View(){return <Image src='/x.png' width={10} height={10}/>}", "jsx-a11y-x/alt-text"],
  ["invalid ARIA name", component('<div aria-invalid-prop="true" />'), "jsx-a11y-x/aria-props"],
  ["invalid ARIA value", component('<div aria-hidden="invalid" />'), "jsx-a11y-x/aria-proptypes"],
  ["ARIA on unsupported element", component('<meta aria-label="text" />'), "jsx-a11y-x/aria-unsupported-elements"],
  ["missing required ARIA", component('<div role="checkbox" />'), "jsx-a11y-x/role-has-required-aria-props"],
  ["unsupported role ARIA", component('<div role="button" aria-checked="false" />'), "jsx-a11y-x/role-supports-aria-props"],
  ["conditional hook", "import {useState} from 'react'; export function View({active}:{active:boolean}){if(active){useState(0)}return <span/>}", "react-hooks/rules-of-hooks"],
  ["sync script", component('<script src="/x.js" />'), "@next/next/no-sync-scripts"],
];
const accepted = [
  component("<span>Bob&apos;s &quot;tasks&quot; &gt; &#125;</span>"),
  component(`<span>{${JSON.stringify("Bob's \"tasks\" > }")}}</span>`),
  "import {useRef} from 'react'; export function View(){const ref=useRef<HTMLInputElement>(null);return <input ref={ref}/>}",
  "import React from 'react'; React.createElement('div',{dangerouslySetInnerHTML:{__html:'safe'}})",
  "import React from 'react'; React.createElement('div',{'dangerouslySetInnerHTML':{__html:'safe'}})",
  "import React from 'react'; React.createElement('div',null,'child')",
  "document.createElement('div')",
];

async function main() {
  const eslint = new ESLint({ cwd: root });
  const filePath = path.join(root, "components", "lint-fixture.tsx");
  for (const [label, source, ruleId] of rejected) {
    const [result] = await eslint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === ruleId), `${label}: ${JSON.stringify(result.messages)}`);
  }
  for (const source of accepted) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.deepEqual(result.messages, [], `Valid code rejected: ${JSON.stringify(result.messages)}`);
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-simply-tasks-lint-"));
  try {
    fs.symlinkSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "junction");
    const sourcePath = path.join(temporary, "invalid.tsx");
    fs.writeFileSync(sourcePath, `import React from "react";
export function Invalid() { return <><div title="a" title="b"/><MissingComponent/></>; }
export class MissingRenderReturn extends React.Component { render() {} }
`);
    const configPath = path.join(temporary, "tsconfig.json");
    fs.writeFileSync(configPath, JSON.stringify({
      extends: path.join(root, "tsconfig.json"),
      compilerOptions: { noEmit: true, incremental: false },
      files: [sourcePath],
      include: [],
      exclude: [],
    }));
    const compiler = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
    const result = spawnSync(process.execPath, [compiler, "--project", configPath, "--pretty", "false"], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    assert.notEqual(result.status, 0, "TypeScript accepted invalid JSX and render()");
    for (const code of [17001, 2304, 2416]) {
      assert(result.stdout.includes(`TS${code}:`), `Missing TS${code}: ${result.stdout}${result.stderr}`);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Quality gates passed: ${rejected.length} invalid lint cases, ${accepted.length} valid cases, 3 TypeScript diagnostics.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
