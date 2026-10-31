using System;
using System.Runtime.InteropServices;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPennyWiseActivationManager
{
    [PreserveSig]
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}

public static class PennyWiseApplication
{
    public static uint Start(string appUserModelId, string arguments)
    {
        var type = Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"));
        var manager = (IPennyWiseActivationManager)Activator.CreateInstance(type);
        try {
            uint processId;
            int result = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        } finally { Marshal.ReleaseComObject(manager); }
    }
}
