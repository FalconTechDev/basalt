---
# a comment
title: 'It''s "quoted"'
double: "tab\there é \"q\" \\ \n end"
url: http://example.com/a#frag
colon: "a: b"
hash: value # trailing comment
nohash: value#nocomment
yes_no: [yes, no, on, off, y, n, Yes, NO, True, FALSE, null, Null, ~]
numbers: [1, -1, +1, 1.5, .5, 5., 1e3, 1E-3, 0x1f, 0o7, 0b1, 010, 1_000, 0.1e1, .inf, -.Inf, .NaN]
strings: [ "1", '2', '3.0', "true", 'null' ]
dates: [2024-01-02, 2024-01-02T10:00:00Z, 10:30, "2024-01-02"]
flow: {a: 1, b: [x, y], c: {d: e}}
empty_list: []
empty_map: {}
nested:
  - name: one
    tags: [a, b]
  - name: two
    meta:
      k: v
  -
    - deep
    - list
block: |
  keep
    indented
  last

fold: >-
  folded
  text

  para
keep: |+
  trailing

unicode: "日本語 😀"
emoji key 😀: yes
"quoted key": 1
alias_src: &anc [1, 2]
alias_use: *anc
merge: &base {x: 1}
tags:
  - "#tag"
  - plain
  - '[[Wikilink in tags]]'
link_md: "[Label](folder/Note%20Name.md#h)"
link_md2: "[Label](<folder/Note Name.md>)"
link_md3: "[Label](https://example.com)"
link_md4: "[Label](note.md 'title')"
link_md5: "![Img](img.png)"
link_wiki: "[[folder/Note#Head^blk|Shown]]"
link_wiki_list:
  - "[[One]]"
  - "[[Two|Alias]]"
  - "not [[inside]]"
link_nested:
  a:
    b: "[[Deep]]"
cssclasses: [wide, narrow]
aliases: Single alias
---
Body with [[Body Link]].
