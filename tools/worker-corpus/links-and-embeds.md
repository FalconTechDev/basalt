# Links

Plain [[Note]] and [[Note|alias]] and [[Note#Heading]] and [[Note#^blockid]] and [[Note#H^b|al]] and [[#Same note heading]].
[[folder/Note With Spaces]] [[ spaced ]] [[a\|b]] [[a|]] [[|b]] [[]] [[ ]] [[[triple]]] [[a[[b]]]] [[x]]]
![[image.png]] ![[image.png|100]] ![[image.png|100x50]] ![[image.png|alt text|200]] ![[Note#Heading]] ![[doc.pdf#page=3]]
![[a|0x0]] ![[a|  12  x  7  ]] ![[a|10x0]] ![[ spaced.png ]]

Markdown links: [text](Note.md) [text](./rel/Note%20Name.md) [text](../up/n.md#head) [text](<with space.md>) [text](a%20b.md "title")
[text](http://example.com/a#b) [text](https://example.com) [text](mailto:a@b.c) [text](#local) [text](%E0%A4%A) [text](caf%C3%A9.md)
[empty]() [text]( spaced.md ) [text](a.md 'single') [text](a.md (paren)) [nested [brackets] text](n.md) [with `code ](x)` more](y.md)
[a](b.md)[c](d.md) [a] (b.md) ![img](pic.png) ![img](pic%20two.png "t") ![img|100](pic.png) ![](empty-alt.png) ![alt](https://x.com/i.png)
![alt|50x20](https://x.com/i.png) ![alt](<spaced name.png>)

Autolinks <http://auto.link/path#frag> <mailto:a@b.c> <a@b.c> <notalink> bare http://bare.link/x#y and https://bare.link/(paren) end.
www.example.com and http://example.com/a_b_c#tag-like.

Reference style: [ref one][r1] and [r2][] and [r3] and ![img ref][r1] and [missing][nope].

[r1]: http://example.com/one "Title"
[r2]: <http://example.com/two>
[R3]: ./local.md
[^notdef]: not a link
[spaced label]:   http://x.com   'single'
[multi]:
  http://y.com
  "title on next line"

Escapes: \[[not a link]] \![[not embed]] \[x](y.md) [x\](y.md) \#notatag \\#tag

Links in tables | a | b |
|---|---|
| [[In Table|a]] | [md](t.md) |
| ![[emb.png]] | #tabletag |
| [[a\|b]] | `[[code]]` |

Code: `[[not]]` and ``[[not]] with ` tick`` and ```[[no]]``` and
```
[[fenced no]] #nofence
```

~~~
[[tilde fence]]
~~~

    [[indented code]] #nocode

<div>[[html block]] #nohtml</div>

Inline html <span>[[inside span]]</span> and <a href="x">[[inside a]]</a> and <!-- [[comment]] -->.

%% comment [[link in comment]] #ctag %%
%%
block comment [[bc]] #bctag
%%

$math [[x]]$ and $$ display [[y]] $$ and $ not math$ and cost $5 and $6.

$$
[[in math block]]
$$
