#define AppName "PennyWise Accounting"
#define AppPublisher "PennyWise Accounting"

[Setup]
AppId={{6E12E26F-7140-49B1-987A-2E931C925A10}
AppName={#AppName}
AppVersion={#Version}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\PennyWise Accounting
DefaultGroupName=PennyWise Accounting
DisableProgramGroupPage=yes
UninstallDisplayName=PennyWise Accounting Beta
UninstallDisplayIcon={app}\PennyWiseAccounting.exe
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
PrivilegesRequired=admin
CloseApplications=yes
RestartApplications=no
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
SignedUninstaller=yes
SignTool=pennywise
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=PennyWise Accounting Beta Setup
VersionInfoProductName=PennyWise Accounting Beta
VersionInfoProductVersion={#Version}
VersionInfoVersion={#Version}

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#CertificatePath}"; Flags: dontcopy
Source: "{#RedistPath}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\PennyWise Accounting\PennyWise Accounting"; Filename: "{app}\PennyWiseAccounting.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\PennyWise Accounting\PennyWise Backup"; Filename: "{app}\PennyWiseBackup.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\PennyWise Accounting\PennyWise Restore"; Filename: "{app}\PennyWiseRestore.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\PennyWise Accounting\PennyWise Support Diagnostics"; Filename: "{app}\PennyWiseDiagnostics.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\PennyWise Accounting\Uninstall PennyWise Accounting"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\PennyWiseAccounting.exe"; Description: "Launch PennyWise Accounting"; Flags: postinstall nowait runasoriginaluser skipifsilent

[Code]
const
  CertificateFile = '{#CertificateFileName}';
  RedistFile = '{#RedistFileName}';
  CertificateThumbprint = '{#CertificateThumbprint}';

function Quoted(const Value: String): String;
begin
  Result := '"' + Value + '"';
end;

procedure StopRunningPennyWise;
var
  DataRoot: String;
  LockFile: String;
  RequestFile: String;
  Attempt: Integer;
begin
  DataRoot := ExpandConstant('{localappdata}\PennyWiseAccounting');
  LockFile := AddBackslash(DataRoot) + 'launcher.lock';
  if not FileExists(LockFile) then
    exit;
  RequestFile := AddBackslash(DataRoot) + 'shutdown-request.json';
  SaveStringToFile(RequestFile, '{"schema":1,"reason":"inno-update"}', False);
  for Attempt := 1 to 180 do
  begin
    if not FileExists(LockFile) then
      exit;
    Sleep(500);
  end;
  if FileExists(LockFile) then
    RaiseException('PennyWise did not close safely for this update. Close PennyWise and run setup again. Existing books were not changed.');
end;

procedure TrustBetaPublisher;
var
  ResultCode: Integer;
  CertificatePath: String;
begin
  ExtractTemporaryFile(CertificateFile);
  CertificatePath := ExpandConstant('{tmp}\') + CertificateFile;
  if not Exec(
    ExpandConstant('{sys}\certutil.exe'),
    '-addstore -f "TrustedPeople" ' + Quoted(CertificatePath),
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
    RaiseException('Windows could not trust the embedded PennyWise beta publisher certificate.');
  if ResultCode <> 0 then
    RaiseException('Windows could not trust the embedded PennyWise beta publisher certificate. Certificate Utility exit code: ' + IntToStr(ResultCode) + '.');
  Log('Trusted PennyWise beta publisher certificate ' + CertificateThumbprint + '.');
end;

procedure InstallMicrosoftRuntime;
var
  ResultCode: Integer;
  RedistPath: String;
begin
  ExtractTemporaryFile(RedistFile);
  RedistPath := ExpandConstant('{tmp}\') + RedistFile;
  if not Exec(RedistPath, '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Windows could not start the bundled Microsoft Visual C++ runtime installer.');
  if (ResultCode <> 0) and (ResultCode <> 1638) then
    RaiseException('The bundled Microsoft Visual C++ runtime installer failed with exit code ' + IntToStr(ResultCode) + '.');
  Log('Microsoft Visual C++ runtime exit code: ' + IntToStr(ResultCode) + '.');
end;

procedure ProvisionBetaForInstallingUser;
var
  ResultCode: Integer;
  NodePath: String;
  ScriptPath: String;
  ActivationPath: String;
  PublicKeyPath: String;
begin
  NodePath := ExpandConstant('{app}\resources\node\node.exe');
  ScriptPath := ExpandConstant('{app}\resources\provision-beta.cjs');
  ActivationPath := ExpandConstant('{app}\resources\activation.json');
  PublicKeyPath := ExpandConstant('{app}\resources\license-public-key.pem');
  if not ExecAsOriginalUser(
    NodePath,
    Quoted(ScriptPath) + ' ' + Quoted(ActivationPath) + ' ' + Quoted(PublicKeyPath),
    ExpandConstant('{app}\resources'),
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
    RaiseException('PennyWise could not provision this beta installation. Existing books were not changed.');
  if ResultCode <> 0 then
    RaiseException('PennyWise could not provision this beta installation. Setup exit code: ' + IntToStr(ResultCode) + '. Existing books were not changed.');
  Log('Offline beta activation provisioned for the installing Windows user.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopRunningPennyWise;
  if CurStep = ssPostInstall then begin
    TrustBetaPublisher;
    InstallMicrosoftRuntime;
    ProvisionBetaForInstallingUser;
  end;
end;
