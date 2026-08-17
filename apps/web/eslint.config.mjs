import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The content-security policy this app ships allows `script-src 'unsafe-inline'`,
    // which Next needs for its own bootstrap unless every inline script carries a
    // nonce. That weakens CSP as an XSS mitigation — so the mitigation that is
    // actually load-bearing here is that the app contains no injection sink at all,
    // and this rule is what keeps that true.
    //
    // It is deliberately the cheap half of the trade: nonce-based CSP is the
    // thorough fix, but a wrong CSP serves a blank page to every visitor, while a
    // lint rule costs nothing and defends the same invariant. If a legitimate need
    // for one of these ever appears, that is the moment to do the CSP work — not the
    // moment to disable the rule.
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "dangerouslySetInnerHTML is an XSS sink and this app's CSP still allows inline script, so it would be exploitable. Render text as children, or sanitize and add a nonce-based CSP first.",
        },
        {
          selector:
            "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message:
            "Assigning innerHTML/outerHTML is an XSS sink. Use textContent, or React children.",
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval executes arbitrary strings as code. There is no use for it here.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function() is eval by another name.",
        },
        {
          // `<a target="_blank">` without rel="noreferrer" hands the opened page a
          // window.opener handle and leaks the referrer. Next's own rule covers
          // next/link; this covers plain anchors.
          selector:
            "JSXOpeningElement[name.name='a']:has(JSXAttribute[name.name='target'][value.value='_blank']):not(:has(JSXAttribute[name.name='rel']))",
          message:
            'target="_blank" needs rel="noreferrer" (or "noopener noreferrer") so the opened page gets no window.opener handle.',
        },
      ],
    },
  },
]);

export default eslintConfig;
