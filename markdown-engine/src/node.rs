use crate::util::S;

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Pt {
    pub line: usize,
    pub col: usize,
    pub off: i64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ty {
    Root,
    Paragraph,
    Heading,
    Code,
    Math,
    Blockquote,
    Callout,
    CalloutTitle,
    CalloutContent,
    List,
    ListItem,
    ThematicBreak,
    Html,
    Table,
    TableRow,
    TableCell,
    Definition,
    FootnoteDefinition,
    Yaml,
    Comment,
    Blockid,
    Text,
    Break,
    Emphasis,
    Strong,
    Delete,
    Mark,
    InlineCode,
    InlineMath,
    Link,
    Image,
    LinkReference,
    ImageReference,
    ILink,
    IEmbed,
    Tag,
    Footnote,
    FootnoteReference,
    FnRef,
    Checklist,
    FnSection,
    FnBackref,
    FnLink,
    Raw,
}

#[derive(Clone, Default, Debug)]
pub struct Callout {
    pub ty: S,
    pub fold: S,
    pub data: S,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub ty: Ty,
    pub s: Pt,
    pub e: Pt,
    pub ch: Vec<Node>,
    pub val: S,
    pub url: S,
    pub title: Option<S>,
    pub alt: Option<S>,
    pub lang: Option<S>,
    pub meta: Option<S>,
    pub ident: S,
    pub label: S,
    pub reftype: u8, // 0 shortcut 1 collapsed 2 full
    pub depth: usize,
    pub ordered: bool,
    pub start: Option<u64>,
    pub spread: bool,
    pub checked: Option<bool>,
    pub checklist: Option<S>,
    pub align: Vec<u8>, // 0 none, 1 left, 2 right, 3 center
    pub id: Option<S>,
    pub callout: Option<Callout>,
    pub converted: bool,
    pub synthetic: bool,
    pub is_inline_fn: bool,
    pub content_pos: Option<(Pt, Pt)>,
    pub width: Option<S>,
    pub height: Option<S>,
    pub data_line: Option<usize>,
    pub list_parent: Option<Pt>, // start of the parent list item (for `parent`)
    pub orig_url: S,
    pub fn_id: S, // footnote numbering, e.g. "1" or "1-2"
    pub is_math_block: bool,
}

impl Node {
    pub fn new(ty: Ty) -> Node {
        Node {
            ty,
            s: Pt::default(),
            e: Pt::default(),
            ch: Vec::new(),
            val: S::new(),
            url: S::new(),
            title: None,
            alt: None,
            lang: None,
            meta: None,
            ident: S::new(),
            label: S::new(),
            reftype: 0,
            depth: 0,
            ordered: false,
            start: None,
            spread: false,
            checked: None,
            checklist: None,
            align: Vec::new(),
            id: None,
            callout: None,
            converted: false,
            synthetic: false,
            is_inline_fn: false,
            content_pos: None,
            width: None,
            height: None,
            data_line: None,
            list_parent: None,
            orig_url: S::new(),
            fn_id: S::new(),
            is_math_block: false,
        }
    }
}
