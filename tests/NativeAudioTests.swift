import AVFoundation
import AudioToolbox
let engine = AVAudioEngine()
let sampler = AVAudioUnitSampler()
engine.attach(sampler)
engine.connect(sampler, to: engine.mainMixerNode, format: nil)
let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
try engine.start()
let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
for program in 0...127 {
    sampler.sendController(120, withValue: 0, onChannel: 0)
    try sampler.loadSoundBankInstrument(at: bank, program: UInt8(program), bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB), bankLSB: 0)
    sampler.startNote(60, withVelocity: 100, onChannel: 0)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
    var maximum: Float = 0
    for _ in 0..<4 {
        let status = try engine.renderOffline(4096, to: buffer)
        if status == .success, let channels = buffer.floatChannelData {
            for channel in 0..<Int(format.channelCount) { for frame in 0..<Int(buffer.frameLength) { maximum = max(maximum,abs(channels[channel][frame])) } }
        }
    }
    sampler.stopNote(60, onChannel: 0)
    if [0,52,53,57,67,127].contains(program) { print("GM zero-based \(program): rendered peak \(maximum)") }
    if maximum <= 0 { fatalError("No sample audio rendered") }
}
try sampler.loadSoundBankInstrument(at: bank, program: 0, bankMSB: UInt8(kAUSampler_DefaultPercussionBankMSB), bankLSB: 0)
for pitch: UInt8 in [36,42] {
    sampler.sendController(120, withValue: 0, onChannel: 0)
    sampler.startNote(pitch, withVelocity: 100, onChannel: 0)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
    var maximum: Float = 0
    for _ in 0..<4 {
        let status = try engine.renderOffline(4096, to: buffer)
        if status == .success, let channels = buffer.floatChannelData {
            for channel in 0..<Int(format.channelCount) { for frame in 0..<Int(buffer.frameLength) { maximum = max(maximum,abs(channels[channel][frame])) } }
        }
    }
    sampler.stopNote(pitch, onChannel: 0)
    print("Percussion bank120 pitch \(pitch): peak \(maximum)")
    if maximum <= 0 { fatalError("No percussion rendered") }
}
engine.stop()
print("PASS: all 128 General MIDI programs loaded and rendered nonzero PCM offline")
