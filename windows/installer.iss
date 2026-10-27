; Inno-Setup-Skript für Souffleur (Installation ohne Adminrechte, pro Benutzer:in)
#define AppVersion GetEnv("SF_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{3F1B7C2E-8A44-4C6E-9D21-5B0E7A9C4F18}
AppName=Souffleur
AppVersion={#AppVersion}
AppPublisher=Honey Balecta
DefaultDirName={localappdata}\Programs\Souffleur
DefaultGroupName=Souffleur
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Souffleur-Setup-{#AppVersion}
SetupIconFile=souffleur.ico
UninstallDisplayIcon={app}\Souffleur.exe
Compression=lzma2/normal
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Symbol auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"

[Files]
Source: "..\dist\Souffleur\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; alte Programmdateien entfernen, damit nichts Veraltetes liegen bleibt (Skripte liegen woanders)
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\Souffleur"; Filename: "{app}\Souffleur.exe"
Name: "{autodesktop}\Souffleur"; Filename: "{app}\Souffleur.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Souffleur.exe"; Description: "Souffleur jetzt starten"; Flags: nowait postinstall skipifsilent
