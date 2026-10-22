using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using System.Text.Json;
using var devices = new MMDeviceEnumerator();
foreach (var device in devices.EnumerateAudioEndPoints(DataFlow.All, DeviceState.All))
    using (device) Console.WriteLine(JsonSerializer.Serialize(new { device.ID, device.FriendlyName, device.State, device.DataFlow }));
using var output = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console);
Console.WriteLine(JsonSerializer.Serialize(new { defaultOutput = output.ID, output.FriendlyName, output.State, session = System.Diagnostics.Process.GetCurrentProcess().SessionId, Environment.UserInteractive }));
if (!args.Contains("--capture")) return;
var destination = args.First(value => value.EndsWith(".wav", StringComparison.Ordinal));
using var capture = new WasapiLoopbackCapture(output);
using var playback = new WaveOutEvent();
playback.Init(new SignalGenerator(48000, 2) { Gain = 0.1, Frequency = 997, Type = SignalGeneratorType.Sin });
using (var writer = new WaveFileWriter(destination, capture.WaveFormat)) {
    var stopped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    capture.DataAvailable += (_, data) => writer.Write(data.Buffer, 0, data.BytesRecorded);
    capture.RecordingStopped += (_, data) => { if (data.Exception is not null) stopped.SetException(data.Exception); else stopped.SetResult(); };
    playback.Play(); capture.StartRecording(); await Task.Delay(3000); capture.StopRecording();
    await stopped.Task.WaitAsync(TimeSpan.FromSeconds(10)); playback.Stop();
}
using var reader = new AudioFileReader(destination);
var samples = new List<float>(); var buffer = new float[4096]; int count;
while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
    for (var index = 0; index < count; index += reader.WaveFormat.Channels) samples.Add(buffer[index]);
var duration = (double)samples.Count / reader.WaveFormat.SampleRate;
var rms = Math.Sqrt(samples.Sum(value => (double)value * value) / Math.Max(1, samples.Count));
var amplitude = 0.0;
for (var offset = -8; offset <= 8; offset++) {
    var coefficient = 2 * Math.Cos(2 * Math.PI * (997 + offset * 0.5) / reader.WaveFormat.SampleRate);
    double previous = 0, older = 0;
    foreach (var sample in samples) { var current = sample + coefficient * previous - older; older = previous; previous = current; }
    amplitude = Math.Max(amplitude, 2 * Math.Sqrt(Math.Max(0, previous * previous + older * older - coefficient * previous * older)) / Math.Max(1, samples.Count));
}
Console.WriteLine(JsonSerializer.Serialize(new { duration, rms, amplitude, capture.WaveFormat.SampleRate, capture.WaveFormat.Channels, destination }));
if (duration < 2 || rms < 0.02 || amplitude < 0.03) throw new InvalidDataException("Actual default-endpoint loopback did not capture the independently played tone");
