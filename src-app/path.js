// Compatibility shim: the path helpers now live in n-g28-path.js (clean-room).
// This file only re-exports them so existing `from "./path.js"` imports and the
// spec tests that import "path.js" keep working. formDecode/formEncode are
// re-exported from text.js (their canonical home).
import { lastSegment, parentPath, isHiddenPath, baseName, withoutExtension, extensionOf, joinNameExt, collapseSlashes, plainSpaces, normalizePath, displayName, withoutMd, dropMdSuffix, fileLinkPath, targetText, isPluginFileName, pathWith, linkPath, parseLinktext, subpathKind, isLocalLink, linkDestination, safeDecodeUri, escapeLinkChars, firstHeadingText, headingTrail, tidyLinkTarget } from "./n-g28-path.js";
import { formDecode, formEncode } from "./text.js";

export { lastSegment, parentPath, isHiddenPath, baseName, withoutExtension, extensionOf, joinNameExt, collapseSlashes, plainSpaces, normalizePath, displayName, withoutMd, dropMdSuffix, fileLinkPath, targetText, isPluginFileName, pathWith, linkPath, parseLinktext, subpathKind, isLocalLink, linkDestination, safeDecodeUri, escapeLinkChars, firstHeadingText, headingTrail, tidyLinkTarget, formDecode, formEncode };
