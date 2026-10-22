using System;
using System.Runtime.InteropServices;

public static class AudioFixtureEndpoint
{
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEndpoints
    {
        [PreserveSig] int Enumerate(int flow, uint states, out IntPtr devices);
        [PreserveSig] int GetDefault(int flow, int role, out IDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevice
    {
        [PreserveSig] int Activate(ref Guid id, uint context, IntPtr parameters, out IntPtr instance);
        [PreserveSig] int OpenProperties(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string identity);
        [PreserveSig] int GetState(out uint state);
    }
    public static string DefaultRenderIdentity()
    {
        var instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), true));
        IDevice device = null;
        try
        {
            // eRender and eConsole match the recorder's production selection.
            Marshal.ThrowExceptionForHR(((IEndpoints)instance).GetDefault(0, 0, out device));
            uint state;
            Marshal.ThrowExceptionForHR(device.GetState(out state));
            if (state != 1) throw new InvalidOperationException("The default render endpoint is not active");
            string identity;
            Marshal.ThrowExceptionForHR(device.GetId(out identity));
            return identity;
        }
        finally
        {
            if (device != null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(instance);
        }
    }
}
