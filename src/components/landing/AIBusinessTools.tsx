import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  Calendar,
  Target,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

type ActiveTool = "calculator" | "score";

export function AIBusinessTools() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("calculator");
  
  // Calculator state
  const [cleansPerWeek, setCleansPerWeek] = useState(10);
  const [avgCleanPrice, setAvgCleanPrice] = useState(150);
  /**
   * The visitor's own assumption, not our claim.
   *
   * This was a hardcoded 0.35 presented as "+35% growth", with no study, cohort
   * or internal data behind it — and the "$25,200 extra yearly" figure beside it
   * was the same constant multiplied out, so one unsourced number was rendered
   * twice and read as two. A quantified earnings promise to business owners is
   * not something to invent, so the rate is now an input: they set it, we do the
   * arithmetic. Defaults to a deliberately modest 10%.
   */
  const [growthRate, setGrowthRate] = useState(10);
  const [showResults, setShowResults] = useState(false);
  
  // Health score state
  const [usesSchedulingSoftware, setUsesSchedulingSoftware] = useState(false);
  const [acceptsOnlinePayments, setAcceptsOnlinePayments] = useState(false);
  const [hasRecurringClients, setHasRecurringClients] = useState(false);
  const [tracksExpenses, setTracksExpenses] = useState(false);
  const [sendsReminders, setSendsReminders] = useState(false);
  const [hasReviewSystem, setHasReviewSystem] = useState(false);
  const [showScore, setShowScore] = useState(false);
  
  // Calculator results
  const currentMonthlyRevenue = cleansPerWeek * 4 * avgCleanPrice;
  const projectedIncrease = Math.round(currentMonthlyRevenue * (growthRate / 100));
  const projectedMonthlyRevenue = currentMonthlyRevenue + projectedIncrease;
  const projectedYearlyGrowth = projectedIncrease * 12;
  
  // Health score calculation
  const healthFactors = [
    { checked: usesSchedulingSoftware, label: "Scheduling software", weight: 20 },
    { checked: acceptsOnlinePayments, label: "Online payments", weight: 20 },
    { checked: hasRecurringClients, label: "Recurring clients", weight: 15 },
    { checked: tracksExpenses, label: "Expense tracking", weight: 15 },
    { checked: sendsReminders, label: "Automated reminders", weight: 15 },
    { checked: hasReviewSystem, label: "Review collection", weight: 15 },
  ];
  
  const healthScore = healthFactors.reduce((acc, f) => acc + (f.checked ? f.weight : 0), 0);
  const missingFeatures = healthFactors.filter(f => !f.checked);
  
  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 50) return "text-warning";
    return "text-destructive";
  };
  
  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Improvement";
  };

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-secondary/30">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4">
            <Sparkles className="h-4 w-4" />
            AI-Powered Business Tools
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            See your growth potential in seconds
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Use our free tools to discover how much more revenue you could generate and identify areas to improve.
          </p>
        </div>

        {/* Tool Switcher */}
        <div className="flex justify-center gap-2 mb-8">
          <Button
            variant={activeTool === "calculator" ? "default" : "outline"}
            onClick={() => { setActiveTool("calculator"); setShowResults(false); }}
            className="gap-2"
          >
            <TrendingUp className="h-4 w-4" />
            Revenue Calculator
          </Button>
          <Button
            variant={activeTool === "score" ? "default" : "outline"}
            onClick={() => { setActiveTool("score"); setShowScore(false); }}
            className="gap-2"
          >
            <Target className="h-4 w-4" />
            Business Health Score
          </Button>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-xl overflow-hidden">
          {/* Revenue Calculator */}
          {activeTool === "calculator" && (
            <div className="p-6 sm:p-8">
              <p className="text-center mb-6">
                <Link
                  to="/tools/house-cleaning-price-calculator"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Try the full price calculator
                </Link>
              </p>
              {!showResults ? (
                <div className="space-y-8">
                  <div className="grid sm:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Cleans per week</Label>
                        <span className="text-2xl font-bold text-primary">{cleansPerWeek}</span>
                      </div>
                      <Slider
                        value={[cleansPerWeek]}
                        onValueChange={([v]) => setCleansPerWeek(v)}
                        min={1}
                        max={100}
                        step={1}
                        className="py-2"
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Avg. price per clean</Label>
                        <span className="text-2xl font-bold text-primary">${avgCleanPrice}</span>
                      </div>
                      <Slider
                        value={[avgCleanPrice]}
                        onValueChange={([v]) => setAvgCleanPrice(v)}
                        min={50}
                        max={500}
                        step={10}
                        className="py-2"
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">If you grew by</Label>
                        <span className="text-2xl font-bold text-primary tabular-nums">{growthRate}%</span>
                      </div>
                      <Slider
                        value={[growthRate]}
                        onValueChange={([v]) => setGrowthRate(v)}
                        min={0}
                        max={50}
                        step={5}
                        className="py-2"
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-center">
                    <Button size="lg" onClick={() => setShowResults(true)} className="gap-2 px-8">
                      <Sparkles className="h-4 w-4" />
                      Calculate My Growth Potential
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* "with TIDYWISE" is gone from the label: the visitor set the
                      rate, so this is their scenario and we are only doing the
                      arithmetic. The hours-saved and repeat-customer tiles are
                      gone entirely — both were computed from nothing. */}
                  <div className="text-center">
                    <p className="text-muted-foreground mb-2">
                      At {growthRate}% growth, your monthly revenue would be
                    </p>
                    <p className="text-5xl sm:text-6xl font-bold text-primary">
                      ${projectedMonthlyRevenue.toLocaleString()}
                    </p>
                    <p className="text-success font-medium mt-2">
                      +${projectedIncrease.toLocaleString()} a month on today's $
                      {currentMonthlyRevenue.toLocaleString()}
                    </p>
                  </div>

                  <div className="flex justify-center pt-4">
                    <div className="bg-secondary/50 rounded-xl p-4 text-center w-full sm:w-auto sm:min-w-[260px]">
                      <DollarSign className="h-8 w-8 text-success mx-auto mb-2" />
                      <p className="text-2xl font-bold text-foreground">
                        ${projectedYearlyGrowth.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Extra over a year</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
                    <Button size="lg" className="gap-2">
                      See Plans <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => setShowResults(false)}>
                      Recalculate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Business Health Score */}
          {activeTool === "score" && (
            <div className="p-6 sm:p-8">
              {!showScore ? (
                <div className="space-y-6">
                  <p className="text-center text-muted-foreground mb-4">
                    Check the tools and practices you currently use:
                  </p>
                  
                  <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                    {[
                      { state: usesSchedulingSoftware, setter: setUsesSchedulingSoftware, label: "I use scheduling software", icon: Calendar },
                      { state: acceptsOnlinePayments, setter: setAcceptsOnlinePayments, label: "I accept online payments", icon: DollarSign },
                      { state: hasRecurringClients, setter: setHasRecurringClients, label: "I have recurring client bookings", icon: Users },
                      { state: tracksExpenses, setter: setTracksExpenses, label: "I track expenses digitally", icon: TrendingUp },
                      { state: sendsReminders, setter: setSendsReminders, label: "I send automated reminders", icon: Zap },
                      { state: hasReviewSystem, setter: setHasReviewSystem, label: "I have a review collection system", icon: Target },
                    ].map((item, i) => (
                      <button
                        key={i}
                        onClick={() => item.setter(!item.state)}
                        className={cn(
                          "flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left",
                          item.state 
                            ? "border-primary bg-primary/10" 
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                          item.state ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                        )}>
                          <item.icon className="h-5 w-5" />
                        </div>
                        <span className={cn(
                          "font-medium",
                          item.state ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex justify-center pt-4">
                    <Button size="lg" onClick={() => setShowScore(true)} className="gap-2 px-8">
                      <Sparkles className="h-4 w-4" />
                      Get My Health Score
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="text-center">
                    <p className="text-muted-foreground mb-2">Your Business Health Score</p>
                    <div className="relative inline-flex items-center justify-center">
                      <div className={cn(
                        "text-7xl font-bold",
                        getScoreColor(healthScore)
                      )}>
                        {healthScore}
                      </div>
                      <span className="text-2xl text-muted-foreground ml-1">/100</span>
                    </div>
                    <p className={cn("text-lg font-medium mt-2", getScoreColor(healthScore))}>
                      {getScoreLabel(healthScore)}
                    </p>
                  </div>
                  
                  {missingFeatures.length > 0 && (
                    <div className="bg-secondary/50 rounded-xl p-5 max-w-xl mx-auto">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                        <p className="font-semibold text-foreground">Areas for Improvement</p>
                      </div>
                      <ul className="space-y-2">
                        {missingFeatures.map((f, i) => (
                          <li key={i} className="flex items-center gap-2 text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                            {f.label} (+{f.weight} points)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <div className="bg-primary/10 rounded-xl p-5 max-w-xl mx-auto">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground mb-1">
                          TIDYWISE includes all these features
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Get scheduling, payments, recurring bookings, expense tracking, automated reminders, and review collection all in one platform.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <Button size="lg" className="gap-2">
                      See Plans <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => setShowScore(false)}>
                      Retake Assessment
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
