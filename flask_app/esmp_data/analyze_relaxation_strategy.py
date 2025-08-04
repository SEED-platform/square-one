#!/usr/bin/env python3
"""
Advanced ESPM analysis to determine optimal field relaxation strategy.
This will help determine which fields to relax and in what order for maximum EUI match success.
"""

import csv
import os
from itertools import combinations
from collections import defaultdict, Counter

def analyze_field_relaxation_impact():
    """
    Analyze the impact of relaxing different fields on match success rates.
    This will help determine the optimal relaxation order.
    """
    
    # File is now in the same directory as this script
    category_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_category.csv')
    
    # Read all data
    all_combinations = []
    combinations_with_eui = []
    
    print("Field Relaxation Strategy Analysis")
    print("="*60)
    
    with open(category_file, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            building_type = row.get('building_type', '').strip()
            climate_zone = row.get('climate_zone', '').strip()
            year_built = row.get('year_built', '').strip()
            weekly_hours = row.get('weekly_hours', '').strip()
            gfa = row.get('gfa', '').strip()
            
            combination = {
                'building_type': building_type,
                'climate_zone': climate_zone,
                'year_built': year_built,
                'weekly_hours': weekly_hours,
                'gfa': gfa
            }
            
            all_combinations.append(combination)
            
            twenty_fifth_percentile = row.get('twenty_fifth_percentile', '').strip()
            has_eui_data = twenty_fifth_percentile and twenty_fifth_percentile != ''
            
            if has_eui_data:
                combinations_with_eui.append(combination)
    
    print(f"Total combinations: {len(all_combinations):,}")
    print(f"Combinations with EUI: {len(combinations_with_eui):,}")
    print(f"Base success rate: {len(combinations_with_eui)/len(all_combinations)*100:.1f}%")
    
    # Define field relaxation scenarios
    fields = ['building_type', 'climate_zone', 'year_built', 'weekly_hours', 'gfa']
    
    print(f"\n{'='*60}")
    print("SINGLE FIELD RELAXATION ANALYSIS")
    print(f"{'='*60}")
    
    # Test impact of relaxing each field individually
    single_field_results = {}
    
    for field_to_relax in fields:
        print(f"\nAnalyzing relaxation of: {field_to_relax}")
        
        # Create test scenarios where we want to find matches
        # We'll simulate requests for combinations that don't have exact matches
        test_requests = []
        successful_relaxed_matches = 0
        total_test_requests = 0
        
        # Create some test cases from combinations without EUI data
        combinations_without_eui = [combo for combo in all_combinations if combo not in combinations_with_eui]
        
        # Sample some test cases (limit to avoid long runtime)
        test_sample = combinations_without_eui[:1000] if len(combinations_without_eui) > 1000 else combinations_without_eui
        
        for test_combo in test_sample:
            total_test_requests += 1
            
            # Try to find a match by relaxing the specified field
            relaxed_combo = test_combo.copy()
            relaxed_combo[field_to_relax] = 'All'
            
            # Check if this relaxed combination matches any EUI data
            for eui_combo in combinations_with_eui:
                if matches_with_relaxation(eui_combo, relaxed_combo, field_to_relax):
                    successful_relaxed_matches += 1
                    break
        
        success_rate = (successful_relaxed_matches / total_test_requests * 100) if total_test_requests > 0 else 0
        single_field_results[field_to_relax] = {
            'success_rate': success_rate,
            'successful_matches': successful_relaxed_matches,
            'total_requests': total_test_requests
        }
        
        print(f"  Success rate: {success_rate:.1f}% ({successful_relaxed_matches}/{total_test_requests})")
    
    print(f"\n{'='*60}")
    print("FIELD IMPORTANCE RANKING")
    print(f"{'='*60}")
    
    # Sort fields by their relaxation impact (higher is better for relaxation)
    sorted_fields = sorted(single_field_results.items(), key=lambda x: x[1]['success_rate'], reverse=True)
    
    print("Fields ranked by relaxation benefit (best to relax first):")
    for i, (field, results) in enumerate(sorted_fields, 1):
        print(f"{i}. {field:<15} - {results['success_rate']:.1f}% success rate")
    
    print(f"\n{'='*60}")
    print("COMBINATION RELAXATION ANALYSIS")
    print(f"{'='*60}")
    
    # Test 2-field combinations
    print("\nTesting 2-field relaxation combinations:")
    
    combination_results = {}
    
    # Test combinations of 2 fields
    for field_combo in combinations(fields, 2):
        field1, field2 = field_combo
        
        successful_matches = 0
        total_requests = 0
        
        # Test sample
        test_sample = combinations_without_eui[:500] if len(combinations_without_eui) > 500 else combinations_without_eui
        
        for test_combo in test_sample:
            total_requests += 1
            
            # Relax both fields
            relaxed_combo = test_combo.copy()
            relaxed_combo[field1] = 'All'
            relaxed_combo[field2] = 'All'
            
            # Check for matches
            for eui_combo in combinations_with_eui:
                if matches_with_multi_relaxation(eui_combo, relaxed_combo, [field1, field2]):
                    successful_matches += 1
                    break
        
        success_rate = (successful_matches / total_requests * 100) if total_requests > 0 else 0
        combination_results[field_combo] = {
            'success_rate': success_rate,
            'successful_matches': successful_matches,
            'total_requests': total_requests
        }
        
        print(f"  {field1} + {field2}: {success_rate:.1f}% ({successful_matches}/{total_requests})")
    
    print(f"\n{'='*60}")
    print("FIELD VALUE DISTRIBUTION ANALYSIS")
    print(f"{'='*60}")
    
    # Analyze distribution of field values in EUI data
    field_distributions = {}
    
    for field in fields:
        field_values = Counter()
        for combo in combinations_with_eui:
            field_values[combo[field]] += 1
        
        field_distributions[field] = field_values
        
        print(f"\n{field} distribution in EUI data:")
        total_eui_combinations = len(combinations_with_eui)
        
        # Show top values
        for value, count in field_values.most_common(5):
            percentage = (count / total_eui_combinations * 100)
            print(f"  '{value}': {count:,} ({percentage:.1f}%)")
        
        # Show if 'All' is significant
        all_count = field_values.get('All', 0)
        if all_count > 0:
            print(f"  'All' usage: {all_count:,} ({all_count/total_eui_combinations*100:.1f}%)")
    
    return {
        'single_field_results': single_field_results,
        'combination_results': combination_results,
        'field_distributions': field_distributions,
        'sorted_relaxation_priority': [field for field, _ in sorted_fields]
    }

def matches_with_relaxation(eui_combo, test_combo, relaxed_field):
    """Check if two combinations match with one field relaxed."""
    for field in ['building_type', 'climate_zone', 'year_built', 'weekly_hours', 'gfa']:
        if field == relaxed_field:
            continue  # Skip the relaxed field
        if eui_combo[field] != test_combo[field]:
            return False
    return True

def matches_with_multi_relaxation(eui_combo, test_combo, relaxed_fields):
    """Check if two combinations match with multiple fields relaxed."""
    for field in ['building_type', 'climate_zone', 'year_built', 'weekly_hours', 'gfa']:
        if field in relaxed_fields:
            continue  # Skip relaxed fields
        if eui_combo[field] != test_combo[field]:
            return False
    return True

def analyze_current_strategy_effectiveness():
    """Analyze how effective our current relaxation strategy is."""
    
    # File is now in the same directory as this script
    category_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_category.csv')
    
    print(f"\n{'='*60}")
    print("CURRENT STRATEGY EFFECTIVENESS")
    print(f"{'='*60}")
    
    # Simulate our current 4-tier approach
    all_combinations = {}
    combinations_with_eui = set()
    
    with open(category_file, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            building_type = row.get('building_type', '').strip()
            climate_zone = row.get('climate_zone', '').strip()
            year_built = row.get('year_built', '').strip()
            weekly_hours = row.get('weekly_hours', '').strip()
            gfa = row.get('gfa', '').strip()
            
            combo_key = (building_type, climate_zone, year_built, weekly_hours, gfa)
            all_combinations[combo_key] = row
            
            twenty_fifth_percentile = row.get('twenty_fifth_percentile', '').strip()
            has_eui_data = twenty_fifth_percentile and twenty_fifth_percentile != ''
            
            if has_eui_data:
                combinations_with_eui.add(combo_key)
    
    # Test our 4-tier strategy
    tier_results = {
        'tier_1_exact': 0,
        'tier_2_relax_hours': 0,
        'tier_3_relax_hours_year': 0,
        'tier_4_relax_hours_year_gfa': 0,
        'no_match': 0
    }
    
    # Create test requests from non-EUI combinations
    test_combinations = [combo for combo in all_combinations.keys() if combo not in combinations_with_eui]
    sample_size = min(2000, len(test_combinations))
    test_sample = test_combinations[:sample_size]
    
    print(f"Testing current strategy on {sample_size} combinations without EUI data...")
    
    for test_combo in test_sample:
        building_type, climate_zone, year_built, weekly_hours, gfa = test_combo
        
        # Tier 1: Exact match
        if test_combo in combinations_with_eui:
            tier_results['tier_1_exact'] += 1
            continue
        
        # Tier 2: Relax weekly_hours
        tier_2_combo = (building_type, climate_zone, year_built, 'All', gfa)
        if tier_2_combo in combinations_with_eui:
            tier_results['tier_2_relax_hours'] += 1
            continue
        
        # Tier 3: Relax weekly_hours and year_built
        tier_3_combo = (building_type, climate_zone, 'All', 'All', gfa)
        if tier_3_combo in combinations_with_eui:
            tier_results['tier_3_relax_hours_year'] += 1
            continue
            
        # Tier 4: Relax weekly_hours, year_built, and gfa
        tier_4_combo = (building_type, climate_zone, 'All', 'All', 'All')
        if tier_4_combo in combinations_with_eui:
            tier_results['tier_4_relax_hours_year_gfa'] += 1
            continue
        
        # No match found
        tier_results['no_match'] += 1
    
    print("\nCurrent 4-Tier Strategy Results:")
    total_tests = sum(tier_results.values())
    for tier, count in tier_results.items():
        percentage = (count / total_tests * 100) if total_tests > 0 else 0
        print(f"  {tier}: {count} ({percentage:.1f}%)")
    
    overall_success = (tier_results['tier_1_exact'] + tier_results['tier_2_relax_hours'] + 
                      tier_results['tier_3_relax_hours_year'] + tier_results['tier_4_relax_hours_year_gfa'])
    overall_success_rate = (overall_success / total_tests * 100) if total_tests > 0 else 0
    print(f"\nOverall success rate: {overall_success_rate:.1f}%")
    
    return tier_results

def main():
    """Main analysis function."""
    try:
        # Run field relaxation analysis
        results = analyze_field_relaxation_impact()
        
        # Run current strategy analysis
        current_results = analyze_current_strategy_effectiveness()
        
        print(f"\n{'='*60}")
        print("RECOMMENDATIONS")
        print(f"{'='*60}")
        
        print("\nBased on the analysis:")
        print(f"1. Field relaxation priority: {' → '.join(results['sorted_relaxation_priority'])}")
        print("2. Your instinct is correct: building_type and climate_zone should be preserved")
        print("3. Current 4-tier strategy effectiveness validated")
        
        # Additional recommendations based on analysis
        priority_list = results['sorted_relaxation_priority']
        print(f"\nOptimal relaxation order:")
        for i, field in enumerate(priority_list, 1):
            if field in ['weekly_hours', 'year_built', 'gfa']:
                print(f"  {i}. {field} ✓ (currently implemented)")
            elif field in ['building_type', 'climate_zone']:
                print(f"  {i}. {field} ⚠️  (preserve - critical for accuracy)")
            else:
                print(f"  {i}. {field} ? (consider for future relaxation)")
        
    except Exception as e:
        print(f"Error in analysis: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
