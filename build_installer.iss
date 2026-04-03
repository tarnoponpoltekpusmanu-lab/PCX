; //#######################################################################
; // APP NAME : Flowork OS Installer Script
; // File NAME : build_installer.iss
; //#######################################################################

[Setup]
AppId={{FLOWORK-OS-GOD-MODE-123456}
AppName=Flowork OS
AppVersion=1.0.6
AppPublisher=Flowork OS
AppPublisherURL=https://www.floworkos.com
; Install ke LocalAppData agar Go Engine bebas membuat folder 'apps' & 'nodes' tanpa terblokir UAC Windows
DefaultDirName={localappdata}\FloworkOS
DisableProgramGroupPage=yes
; Output folder tempat Setup.exe akan muncul
OutputDir=.\Installer_Output
; Nama file Installer yang akan dibagikan ke user
OutputBaseFilename=FloworkOS_v1.0.6
; Icon untuk file Setup.exe (Pastikan icon.ico ada di folder yang sama dengan script ini)
SetupIconFile=icon.ico
; Kompresi level DEWA (LZMA2), ukurannya bakal jadi 3MB!
Compression=lzma2/ultra64
SolidCompression=yes
; Tidak butuh akses Run As Administrator saat install
PrivilegesRequired=lowest

[Files]
; Memasukkan Otak (Go Engine)
Source: "FloworkOS_v1.0.6.exe"; DestDir: "{app}"; Flags: ignoreversion
; Memasukkan Wajah (Electron GUI)
Source: "gui.exe"; DestDir: "{app}"; Flags: ignoreversion
; [PERBAIKAN ICON] Memasukkan file icon secara fisik ke folder instalasi
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion
; [KODE BARU] Memasukkan seluruh folder 'runtimes' secara fisik (FFMPEG, Python, NodeJS, Ruby) ke dalam Installer
Source: "runtimes\*"; DestDir: "{app}\runtimes"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; [PERBAIKAN ICON] Shortcut Desktop langsung tembak ke flowork-core.exe, TAPI gambarnya dipaksa pakai icon.ico
Name: "{autodesktop}\Flowork OS"; Filename: "{app}\FloworkOS_v1.0.6.exe"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\Flowork AI Builder"; Filename: "{app}\gui.exe"; Parameters: "--ai-builder"; IconFilename: "{app}\icon.ico"
; [PERBAIKAN ICON] Shortcut Start Menu juga dipaksa pakai icon.ico
Name: "{userprograms}\Flowork OS"; Filename: "{app}\FloworkOS_v1.0.6.exe"; IconFilename: "{app}\icon.ico"
Name: "{userprograms}\Flowork AI Builder"; Filename: "{app}\gui.exe"; Parameters: "--ai-builder"; IconFilename: "{app}\icon.ico"

[Run]
; Otomatis jalankan Otak setelah instalasi selesai
Filename: "{app}\FloworkOS_v1.0.6.exe"; Description: "Jalankan Flowork OS Sekarang"; Flags: nowait postinstall skipifsilent