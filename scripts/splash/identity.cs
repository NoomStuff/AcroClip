// What the shared splash.cs needs to know about this app. Everything else in the
// splash is the same in AcroClip, AttaCut and Deduup.
using System.Drawing;

internal static class Identity
{
    internal const string Name = "AcroClip";
    internal const string Slug = "acroclip";
    // electron-builder's product executable becomes the launcher; Electron runs as this.
    internal const string RuntimeExe = "AcroClip-app.exe";
    internal const string SignalVariable = "ACROCLIP_SPLASH_SIGNAL";
    internal static readonly Color Background = Color.FromArgb(13, 12, 15);
    internal static readonly Color Border = Color.FromArgb(38, 34, 46);
    internal static readonly Color Accent = Color.FromArgb(177, 151, 252);
    // Arguments that run a command instead of opening the app, so they skip the splash.
    internal static readonly string[] QuietArguments = new string[] { "--clip" };
}
