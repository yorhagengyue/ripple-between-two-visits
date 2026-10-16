/**
 * Two faults the visit line reported in the foundation, both closed without changing any earlier use:
 *   - ListItem: an action of four characters or more beside a title took the title's room and broke it into two
 *     lines. `rightPlacement="below"` puts the words under the title and its grey line.
 *   - PageHeader with `line`: on an example account the line 「示例资料：…」 sat right under the hairline. It keeps the
 *     header's own 12px from it now.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListItem } from "@/components/ui";

const css = readFileSync(path.resolve(__dirname, "..", "..", "..", "app", "ripple-ui.css"), "utf8");

describe("ListItem: where the words on the right go", () => {
  it("beside the title unless asked otherwise: the markup of every earlier use is unchanged", () => {
    const out = renderToStaticMarkup(createElement(ListItem, { mark: "todo", title: "10月19日 复诊", sub: "联合诊所", right: "改", rightTone: "accent", chevron: true }));
    expect(out).toContain('<span class="rpu-li-main"><span class="rpu-li-t">10月19日 复诊</span><span class="rpu-li-s">联合诊所</span></span><span class="rpu-li-r" data-tone="accent">改</span>');
    expect(out).not.toContain("data-placement");
  });

  it('rightPlacement="below": the action is the last line of the row\'s own column, in the same weight and tone', () => {
    const out = renderToStaticMarkup(createElement(ListItem, { mark: "todo", title: "两周后回来复诊", sub: "医生说的", right: "约个日子", rightTone: "accent", rightPlacement: "below", chevron: true }));
    expect(out).toContain('<span class="rpu-li-main"><span class="rpu-li-t">两周后回来复诊</span><span class="rpu-li-s">医生说的</span><span class="rpu-li-r" data-tone="accent" data-placement="below">约个日子</span></span>');
    // nothing is left beside the title but the chevron
    expect((out.match(/class="rpu-li-r"/g) ?? []).length).toBe(1);
    expect(css).toContain('.rpu-li-r[data-placement="below"] { max-width: none; text-align: left; }');
  });

  it("without words on the right there is no such element either way", () => {
    expect(renderToStaticMarkup(createElement(ListItem, { title: "x", rightPlacement: "below" }))).not.toContain("rpu-li-r");
  });
});

describe("PageHeader with a hairline, on an account that draws a line under every header", () => {
  it("that line keeps 12px from the hairline (it sat right under it)", () => {
    expect(css).toContain('.rpu-meta[data-line="true"] { border-bottom: 1px solid var(--rp-line); }');
    expect(css).toContain('.rpu-meta[data-line="true"] + .rpu-banner { margin-top: 12px; }');
    // the header's own room above the hairline is the same 12px
    expect(/\.rpu-meta \{[^}]*padding: 0 0 12px;/.test(css)).toBe(true);
  });
});
