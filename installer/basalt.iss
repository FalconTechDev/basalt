; Basalt installer. Build with:  node build-installer.mjs
#define AppName "Basalt"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{B4A5A17C-2F0E-4C7B-9B5E-0A5A17C0DE01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppName}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Basalt-Setup-{#AppVersion}
SetupIconFile=..\branding\icon.ico
UninstallDisplayIcon={app}\Basalt.exe
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "addpath"; Description: "Команда basalt-cli в PATH (управление Basalt из терминала и скриптов)"; GroupDescription: "Автоматизация:"; Flags: checkedonce

[Files]
Source: "..\dist\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\Basalt.exe"; IconFilename: "{app}\Basalt.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Basalt.exe"; IconFilename: "{app}\Basalt.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}\resources\app-src\bin"; Tasks: addpath; Check: NeedsPath(ExpandConstant('{app}\resources\app-src\bin'))

[Code]
function NeedsPath(Dir: string): Boolean;
var P: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', P) then begin Result := True; exit; end;
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(P) + ';') = 0;
end;

[Run]
Filename: "{app}\Basalt.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

