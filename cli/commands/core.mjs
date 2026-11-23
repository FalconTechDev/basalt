// Core commands: version and shell completion.
import { register, registry, GLOBAL_SPEC, VERSION } from "../lib/cli.mjs";
import { usage } from "../lib/util.mjs";

const flagsOf = (c) => Object.keys({ ...GLOBAL_SPEC, ...c.spec }).map((f) => "--" + f);

function bashScript() {
  const cmds = registry.map((c) => c.name), top = [...new Set(cmds.map((c) => c.split(" ")[0]))];
  const len = (n) => cmds.filter((c) => c.split(" ").length === n);
  const L = ["# bash completion for basalt: eval \"$(basalt completion bash)\"", "_basalt() {",
    "  local cur=\"${COMP_WORDS[COMP_CWORD]}\" w1=\"${COMP_WORDS[1]}\" w2=\"${COMP_WORDS[2]}\" w3=\"${COMP_WORDS[3]}\" cmd=\"\" opts=\"\"",
    "  case \"$w1 $w2 $w3\" in"];
  for (const c of len(3)) L.push(`    "${c}") cmd="${c}";;`);
  L.push("    *) case \"$w1 $w2\" in");
  for (const c of len(2)) L.push(`      "${c}") cmd="${c}";;`);
  L.push("      *) case \"$w1\" in");
  for (const c of len(1)) L.push(`        "${c}") cmd="${c}";;`);
  L.push("      esac;; esac;;", "  esac", "  if [ -z \"$cmd\" ]; then");
  L.push(`    if [ "$COMP_CWORD" -eq 1 ]; then opts="${top.join(" ")} help"; else case "$w1" in`);
  for (const t of top) { const subs = [...new Set(cmds.filter((c) => c.startsWith(t + " ")).map((c) => c.split(" ")[1]))]; if (subs.length) L.push(`      ${t}) opts="${subs.join(" ")}";;`); }
  L.push("    esac; fi", "  else case \"$cmd\" in");
  for (const c of registry) L.push(`    "${c.name}") opts="${flagsOf(c).join(" ")}";;`);
  L.push("  esac; fi", "  COMPREPLY=( $(compgen -W \"$opts\" -- \"$cur\") )", "}", "complete -o default -F _basalt basalt basalt-cli");
  return L.join("\n") + "\n";
}

function powershellScript() {
  const L = ["# PowerShell completion for basalt: basalt completion powershell | Out-String | Invoke-Expression", "$script:BasaltCmds = @{"];
  for (const c of registry) L.push(`  '${c.name}' = '${flagsOf(c).join(" ")}'`);
  L.push("}", "Register-ArgumentCompleter -Native -CommandName basalt, basalt-cli -ScriptBlock {", "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $w = @($commandAst.CommandElements | ForEach-Object { $_.ToString() } | Select-Object -Skip 1)",
    "  $words = @($w | Where-Object { $_ -notlike '-*' })",
    "  $cmd = ''; foreach ($n in 3,2,1) { if ($words.Count -ge $n) { $c = ($words[0..($n-1)] -join ' '); if ($script:BasaltCmds.ContainsKey($c)) { $cmd = $c; break } } }",
    "  if ($cmd) { $script:BasaltCmds[$cmd].Split(' ') | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_) } }",
    "  else { $prefix = ($words | Where-Object { $_ -ne $wordToComplete }) -join ' '",
    "    $names = $script:BasaltCmds.Keys | Where-Object { $_ -like \"$prefix*\" } | ForEach-Object { $rest = $_.Substring($prefix.Length).Trim(); ($rest -split ' ')[0] } | Where-Object { $_ -and $_ -like \"$wordToComplete*\" } | Sort-Object -Unique",
    "    $names | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }", "}");
  return L.join("\n") + "\n";
}

register([
  {
    name: "completion", usage: "completion bash|powershell",
    ru: "Скрипт автодополнения для оболочки.\n  bash:        eval \"$(basalt completion bash)\"\n  PowerShell:  basalt completion powershell | Out-String | Invoke-Expression",
    en: "Shell completion script.\n  bash:        eval \"$(basalt completion bash)\"\n  PowerShell:  basalt completion powershell | Out-String | Invoke-Expression",
    run(ctx) {
      const sh = ctx.args[0];
      if (sh === "bash") ctx.print(bashScript().trimEnd()); else if (sh === "powershell" || sh === "pwsh") ctx.print(powershellScript().trimEnd());
      else throw usage("completion needs bash or powershell");
    },
  },
  { name: "version", usage: "version", ru: "Версия командной строки.", en: "Command line version.", run(ctx) { ctx.result({ version: VERSION, node: process.version }, `basalt ${VERSION} (node ${process.version})`, true); } },
]);
