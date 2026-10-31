using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Setup
{
    private static string logFile;
    private static bool quiet;
    [STAThread]
    private static int Main(string[] args)
    {
        quiet = Array.IndexOf(args, "--unattended") >= 0;
        string logRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PennyWiseSetup", "logs");
        Directory.CreateDirectory(logRoot);
        logFile = Path.Combine(logRoot, DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Process.GetCurrentProcess().Id + ".log");
        if (Array.IndexOf(args, "--prerequisites") >= 0) return Guard(InstallPrerequisites);
        if (quiet) return Guard(delegate { Install(Array.IndexOf(args, "--no-launch") >= 0); });
        Application.EnableVisualStyles();
        var form = new Form { Text = "PennyWise Accounting Beta Setup", Width = 570, Height = 270, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false };
        var text = new Label { Left = 24, Top = 20, Width = 500, Height = 140, Text = "Install PennyWise Accounting and its bundled dependencies. Your beta activation is included. No account or internet connection is required.\n\nWindows may ask to approve the beta publisher certificate and Microsoft runtime. Nightly recovery copies use OneDrive when available, otherwise this PC. Local copies do not protect against disk failure.\n\nExisting books are preserved by updates and uninstall." };
        var button = new Button { Left = 380, Top = 170, Width = 130, Text = "Install and open" };
        form.Controls.Add(text); form.Controls.Add(button);
        int result = 0;
        button.Click += async delegate {
            button.Enabled = false;
            text.Text = "Installing PennyWise Accounting. This can take several minutes.\n\nPlease approve the Windows prompt if one appears.";
            result = await Task.Run(() => Guard(delegate { Install(false); }));
            if (result == 0) form.Close();
            else { text.Text = "Setup did not finish. Your books have been preserved.\n\nDetails: " + logFile; button.Text = "Retry"; button.Enabled = true; }
        };
        Application.Run(form);
        return result;
    }

    private static int Guard(Action action)
    {
        try { action(); Log("PASS"); return 0; }
        catch (Exception ex) { Log(ex.ToString()); if (!quiet) MessageBox.Show(ex.Message + "\n\nSetup log: " + logFile, "PennyWise setup", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }

    private static void Install(bool noLaunch)
    {
        if (!Environment.Is64BitOperatingSystem) throw new Exception("PennyWise requires 64-bit Windows 11.");
        string stage = NewStage();
        try {
            Extract("package.msix", stage); Extract("publisher.cer", stage); Extract("activation.json", stage);
            VerifyHash(Path.Combine(stage, "package.msix"), ReadText("package.sha256").Trim());
            Log("Embedded package checksum verified.");
            if (PrerequisitesPresent()) Log("Required runtime and beta publisher are already installed.");
            else if (IsAdministrator()) InstallPrerequisites();
            else {
                var helper = Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--prerequisites") { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
                helper.WaitForExit();
                if (helper.ExitCode != 0) throw new Exception("Windows prerequisites were not installed. Approve the Windows prompt and retry setup.");
            }
            string script = ReadText("install.ps1");
            var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoLogo -NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script))) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.EnvironmentVariables["PENNYWISE_SETUP_ROOT"] = stage;
            start.EnvironmentVariables["PENNYWISE_SETUP_NO_LAUNCH"] = noLaunch ? "1" : "0";
            using (var process = Process.Start(start)) {
                process.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
                process.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
                process.BeginOutputReadLine(); process.BeginErrorReadLine(); process.WaitForExit();
                if (process.ExitCode != 0) throw new Exception("PennyWise setup or first launch failed. See the setup log for the exact error.");
            }
        } finally { Directory.Delete(stage, true); }
    }

    private static void InstallPrerequisites()
    {
        if (!IsAdministrator()) throw new Exception("Windows administrator approval is required to trust this beta publisher.");
        string stage = NewStage();
        try {
            Extract("publisher.cer", stage); Extract("vc_redist.x64.exe", stage);
            VerifyHash(Path.Combine(stage, "vc_redist.x64.exe"), ReadText("vcredist.sha256").Trim());
            using (var store = new X509Store(StoreName.TrustedPeople, StoreLocation.LocalMachine)) {
                store.Open(OpenFlags.ReadWrite);
                store.Add(new X509Certificate2(Path.Combine(stage, "publisher.cer")));
            }
            Log("Embedded beta publisher trusted in LocalMachine TrustedPeople.");
            using (var process = Process.Start(new ProcessStartInfo(Path.Combine(stage, "vc_redist.x64.exe"), "/install /quiet /norestart") { UseShellExecute = false, CreateNoWindow = true })) {
                process.WaitForExit(); Log("Microsoft runtime exit: " + process.ExitCode);
                if (process.ExitCode == 3010) throw new Exception("Windows requires a restart to finish the Microsoft runtime installation. Restart Windows, then run PennyWise setup again.");
                if (process.ExitCode != 0 && process.ExitCode != 1638) throw new Exception("Microsoft runtime installation failed with code " + process.ExitCode + ".");
            }
        } finally { Directory.Delete(stage, true); }
    }

    private static bool IsAdministrator() { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
    private static bool PrerequisitesPresent() {
        string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        foreach (string name in new[] { "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll" }) {
            string file = Path.Combine(system, name);
            if (!File.Exists(file)) return false;
            var version = FileVersionInfo.GetVersionInfo(file);
            if (version.FileMajorPart < 14 || (version.FileMajorPart == 14 && version.FileMinorPart < 44)) return false;
        }
        using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("publisher.cer")) using (var buffer = new MemoryStream()) {
            input.CopyTo(buffer);
            var cert = new X509Certificate2(buffer.ToArray());
            using (var store = new X509Store(StoreName.TrustedPeople, StoreLocation.LocalMachine)) {
                store.Open(OpenFlags.ReadOnly);
                return store.Certificates.Find(X509FindType.FindByThumbprint, cert.Thumbprint, false).Count > 0;
            }
        }
    }
    private static string NewStage() { string path = Path.Combine(Path.GetTempPath(), "PennyWiseSetup-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(path); return path; }
    private static string ReadText(string name) { using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) using (var reader = new StreamReader(stream)) return reader.ReadToEnd(); }
    private static void Extract(string name, string stage) { using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) using (var output = new FileStream(Path.Combine(stage, name), FileMode.CreateNew)) input.CopyTo(output); }
    private static void VerifyHash(string file, string expected) { using (var hash = SHA256.Create()) using (var input = File.OpenRead(file)) if (BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant() != expected.ToLowerInvariant()) throw new Exception("The embedded installer payload is damaged. Obtain a new copy."); }
    private static readonly object logLock = new object();
    private static void Log(string message) { lock (logLock) File.AppendAllText(logFile, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine); }
}
