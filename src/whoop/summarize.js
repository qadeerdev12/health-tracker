/**
 * Joins the WHOOP collections into one row per physiological cycle (a "day"),
 * and converts WHOOP's units into the ones a health app actually displays.
 *
 * Cycles, recoveries and sleeps are all keyed by `cycle_id`, which is what makes
 * the join possible — recovery and sleep both carry it.
 */

const KJ_TO_KCAL = 0.239006;

export const kilojouleToKcal = (kj) => (typeof kj === 'number' ? kj * KJ_TO_KCAL : null);

/** WHOOP timestamps are UTC; `timezone_offset` ("-05:00") puts them back in the user's day. */
export function localDate(isoTimestamp, timezoneOffset = '+00:00') {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezoneOffset ?? '');
  let shiftMinutes = 0;
  if (match) {
    const [, sign, hours, minutes] = match;
    shiftMinutes = (Number(hours) * 60 + Number(minutes)) * (sign === '-' ? -1 : 1);
  }
  const shifted = new Date(new Date(isoTimestamp).getTime() + shiftMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

const scored = (record) => (record?.score_state === 'SCORED' ? record.score : null);

function summarizeSleep(sleep) {
  const score = scored(sleep);
  if (!sleep) return null;

  const stages = score?.stage_summary;
  const light = stages?.total_light_sleep_time_milli ?? 0;
  const sws = stages?.total_slow_wave_sleep_time_milli ?? 0;
  const rem = stages?.total_rem_sleep_time_milli ?? 0;
  const awake = stages?.total_awake_time_milli ?? 0;

  const need = score?.sleep_needed;
  const neededMilli = need
    ? need.baseline_milli +
      need.need_from_sleep_debt_milli +
      need.need_from_recent_strain_milli +
      need.need_from_recent_nap_milli
    : null;

  return {
    id: sleep.id,
    nap: sleep.nap,
    start: sleep.start,
    end: sleep.end,
    scored: Boolean(score),
    inBedMilli: stages?.total_in_bed_time_milli ?? null,
    asleepMilli: score ? light + sws + rem : null,
    stages: score ? { awake, light, sws, rem } : null,
    neededMilli,
    cycleCount: stages?.sleep_cycle_count ?? null,
    disturbanceCount: stages?.disturbance_count ?? null,
    performancePct: score?.sleep_performance_percentage ?? null,
    efficiencyPct: score?.sleep_efficiency_percentage ?? null,
    consistencyPct: score?.sleep_consistency_percentage ?? null,
    respiratoryRate: score?.respiratory_rate ?? null,
  };
}

function summarizeWorkout(workout) {
  const score = scored(workout);
  return {
    id: workout.id,
    sport: workout.sport_name ?? 'Unknown',
    start: workout.start,
    end: workout.end,
    date: localDate(workout.start, workout.timezone_offset),
    durationMilli: new Date(workout.end) - new Date(workout.start),
    scored: Boolean(score),
    strain: score?.strain ?? null,
    kcal: kilojouleToKcal(score?.kilojoule),
    averageHeartRate: score?.average_heart_rate ?? null,
    maxHeartRate: score?.max_heart_rate ?? null,
    distanceMeter: score?.distance_meter ?? null,
    altitudeGainMeter: score?.altitude_gain_meter ?? null,
    percentRecorded: score?.percent_recorded ?? null,
    zoneDurations: score?.zone_durations ?? null,
  };
}

/**
 * @returns {{days: object[], workouts: object[]}} days newest-first.
 */
export function summarize({ cycles = [], recoveries = [], sleeps = [], workouts = [] }) {
  const recoveryByCycle = new Map(recoveries.map((r) => [r.cycle_id, r]));

  // A cycle can contain naps as well as the main sleep; the longest one is the night.
  const sleepsByCycle = new Map();
  for (const sleep of sleeps) {
    const existing = sleepsByCycle.get(sleep.cycle_id);
    const duration = new Date(sleep.end) - new Date(sleep.start);
    if (!existing || duration > new Date(existing.end) - new Date(existing.start)) {
      sleepsByCycle.set(sleep.cycle_id, sleep);
    }
  }

  const summarizedWorkouts = workouts.map(summarizeWorkout);
  const workoutsByDate = new Map();
  for (const workout of summarizedWorkouts) {
    workoutsByDate.set(workout.date, (workoutsByDate.get(workout.date) ?? 0) + 1);
  }

  const days = cycles
    .map((cycle) => {
      const cycleScore = scored(cycle);
      const recoveryScore = scored(recoveryByCycle.get(cycle.id));
      const date = localDate(cycle.start, cycle.timezone_offset);

      return {
        cycleId: cycle.id,
        date,
        start: cycle.start,
        end: cycle.end ?? null,
        inProgress: !cycle.end,
        strain: cycleScore?.strain ?? null,
        kcal: kilojouleToKcal(cycleScore?.kilojoule),
        averageHeartRate: cycleScore?.average_heart_rate ?? null,
        maxHeartRate: cycleScore?.max_heart_rate ?? null,
        recovery: recoveryScore
          ? {
              score: recoveryScore.recovery_score,
              restingHeartRate: recoveryScore.resting_heart_rate,
              hrvMilli: recoveryScore.hrv_rmssd_milli,
              spo2: recoveryScore.spo2_percentage ?? null,
              skinTempCelsius: recoveryScore.skin_temp_celsius ?? null,
              calibrating: recoveryScore.user_calibrating ?? false,
            }
          : null,
        sleep: summarizeSleep(sleepsByCycle.get(cycle.id)),
        workoutCount: workoutsByDate.get(date) ?? 0,
      };
    })
    .sort((a, b) => new Date(b.start) - new Date(a.start));

  return { days, workouts: summarizedWorkouts };
}

/** WHOOP's own recovery bands — green ≥67, yellow 34–66, red <34. */
export function recoveryBand(score) {
  if (typeof score !== 'number') return 'unknown';
  if (score >= 67) return 'high';
  if (score >= 34) return 'moderate';
  return 'low';
}
