import { Signal } from "../signal/Signal";
import { Multiply } from "../signal/Multiply";
import { AudioToGain } from "../signal/AudioToGain";
import { Gain } from "../core/context/Gain";
import { Positive, Seconds } from "../core/type/Units";
import { Envelope, EnvelopeOptions } from "../component/envelope/Envelope";
import { ToneAudioNode, ToneAudioNodeOptions } from "../core/context/ToneAudioNode";
import { Monophonic } from "../instrument/Monophonic";
import { OmniOscillator } from "../source/oscillator/OmniOscillator";
import { OmniOscillatorSynthOptions } from "../source/oscillator/OscillatorInterface";
import { Source } from "../source/Source";
import { Synth, SynthOptions } from "./Synth";
import { AmplitudeEnvelope } from "../component/envelope/AmplitudeEnvelope";
import { readOnly, RecursivePartial } from "../core/util/Interface";
import { omitFromObject, optionsFromArguments } from "../core/util/Defaults";

interface AMSynthOptions extends SynthOptions {
	harmonicity: Positive;
	modulationEnvelope: Omit<EnvelopeOptions, keyof ToneAudioNodeOptions>;
	modulation: OmniOscillatorSynthOptions;
}

/**
 * AMSynth uses the output of one Tone.Synth to modulate the
 * amplitude of another Tone.Synth. The harmonicity (the ratio between
 * the two signals) affects the timbre of the output signal greatly.
 * Read more about Amplitude Modulation Synthesis on
 * [SoundOnSound](https://web.archive.org/web/20160404103653/http://www.soundonsound.com:80/sos/mar00/articles/synthsecrets.htm).
 *
 * @example
 * import { AMSynth } from "tone";
 * const synth = new AMSynth().toMaster();
 * synth.triggerAttackRelease("C4", "4n");
 */
export class AMSynth extends Monophonic<AMSynthOptions> {

	readonly name: string = "AMSynth";

	/**
	 * The carrier voice.
	 */
	private _carrier: Synth;

	/**
	 * The modulator voice.
	 */

	private _modulator: Synth;

	/**
	 * The carrier's oscillator
	 */
	readonly oscillator: OmniOscillator<any>;

	/**
	 * The carrier's envelope
	 */
	readonly envelope: AmplitudeEnvelope;

	/**
	 * The modulator's oscillator which is applied to the amplitude of the oscillator
	 */
	readonly modulation: OmniOscillator<any>;

	/**
	 * The modulator's envelope
	 */
	readonly modulationEnvelope: AmplitudeEnvelope;

	/**
	 * The frequency control
	 */
	readonly frequency: Signal<"frequency">;

	/**
	 * The detune in cents
	 */
	readonly detune: Signal<"cents">;

	/**
	 * Harmonicity is the ratio between the two voices. A harmonicity of
	 * 1 is no change. Harmonicity = 2 means a change of an octave.
	 * @example
	 * import { AMSynth } from "tone";
	 * const amSynth = new AMSynth().toDestination();
	 * // pitch the modulator an octave below oscillator
	 * amSynth.harmonicity.value = 0.5;
	 * amSynth.triggerAttackRelease("C5", "4n");
	 */
	readonly harmonicity: Multiply;

	/**
	 * The node where the modulation happens
	 */
	private _modulationNode: Gain;

	/**
	 * Scale the oscillator from -1,1 to 0-1
	 */
	private _modulationScale: AudioToGain;

	constructor(options?: RecursivePartial<AMSynthOptions>);
	constructor() {
		super(optionsFromArguments(AMSynth.getDefaults(), arguments));
		const options = optionsFromArguments(AMSynth.getDefaults(), arguments);

		this._carrier = new Synth({
			context: this.context,
			oscillator: options.oscillator,
			envelope: options.envelope,
			volume: -10,
		});
		this._modulator = new Synth({
			context: this.context,
			oscillator: options.modulation,
			envelope: options.modulationEnvelope,
			volume: -10,
		});

		this.oscillator = this._carrier.oscillator;
		this.envelope = this._carrier.envelope;
		this.modulation = this._modulator.oscillator;
		this.modulationEnvelope = this._modulator.envelope;

		this.frequency = new Signal({
			context: this.context,
			units: "frequency",
		});
		this.detune = new Signal({
			context: this.context,
			value: options.detune,
			units: "cents"
		});
		this.harmonicity = new Multiply({
			context: this.context,
			value: options.harmonicity,
		});
		this._modulationNode = new Gain({
			context: this.context,
			gain: 0,
		});
		this._modulationScale = new AudioToGain({
			context: this.context,
		});

		// control the two voices frequency
		this.frequency.connect(this._carrier.frequency);
		this.frequency.chain(this.harmonicity, this._modulator.frequency);
		this.detune.fan(this._carrier.detune, this._modulator.detune);
		this._modulator.chain(this._modulationScale, this._modulationNode.gain);
		this._carrier.chain(this._modulationNode, this.output);
		readOnly(this, ["frequency", "harmonicity", "oscillator", "envelope", "modulation", "modulationEnvelope", "detune"]);
	}

	static getDefaults(): AMSynthOptions {
		return Object.assign(Monophonic.getDefaults(), {
			harmonicity: 3,
			oscillator: Object.assign(
				omitFromObject(OmniOscillator.getDefaults(), [
					...Object.keys(Source.getDefaults()),
					"frequency",
					"detune"
				]),
				{
					type: "sine"
				}
			),
			envelope: Object.assign(
				omitFromObject(
					Envelope.getDefaults(),
					Object.keys(ToneAudioNode.getDefaults())
				),
				{
					attack: 0.01,
					decay: 0.01,
					sustain: 1,
					release: 0.5
				}
			),
			modulation: Object.assign(
				omitFromObject(OmniOscillator.getDefaults(), [
					...Object.keys(Source.getDefaults()),
					"frequency",
					"detune"
				]),
				{
					type: "square"
				}
			),
			modulationEnvelope: Object.assign(
				omitFromObject(
					Envelope.getDefaults(),
					Object.keys(ToneAudioNode.getDefaults())
				),
				{
					attack: 0.5,
					decay: 0.0,
					sustain: 1,
					release: 0.5
				}
			)
		});
	}

	/**
	 * Trigger the attack portion of the note
	 */
	protected _triggerEnvelopeAttack(time: Seconds, velocity: number): void {
		// @ts-ignore
		this._carrier._triggerEnvelopeAttack(time, velocity);
		// @ts-ignore
		this._modulator._triggerEnvelopeAttack(time, velocity);
	}
	
	/**
	 * Trigger the release portion of the note
	 */
	protected _triggerEnvelopeRelease(time: Seconds) {
		// @ts-ignore
		this._carrier._triggerEnvelopeRelease(time);
		// @ts-ignore
		this._modulator._triggerEnvelopeRelease(time);
		return this;
	}

	dispose(): this {
		super.dispose();
		this._carrier.dispose();
		this._modulator.dispose();
		this.frequency.dispose();
		this.detune.dispose();
		this.harmonicity.dispose();
		this._modulationScale.dispose();
		this._modulationNode.dispose();
		return this;
	}
}
